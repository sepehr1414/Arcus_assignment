# Take-Home: Conversation Inbox

> ## ⚠️ Read this first — this is the *extended* version
>
> **There are two versions of this submission.**
>
> The brief says the assistant needs "two or three rules" and to not over-invest,
> but it doesn't say whether a real language model is wanted, and "sometimes reply
> automatically" can reasonably mean either. Rather than guess, I built both:
>
> | Branch | Assistant | Time |
> |---|---|---|
> | **`main`** | Three deterministic rules over the catalog, exactly as the brief describes | ~2 hours, as asked |
> | **`llm-assistant`** (this one) | **Google Gemini**, grounded in a catalog / policy / order dataset, with a validator that re-checks every factual claim before it is stored | extra, done on my own time |
>
> **If you are assessing against the brief, read `main`.** It is the complete,
> time-boxed answer to all seven required items.
>
> This branch is what I would build for production, and it exists because the
> interesting problem in an LLM support agent isn't calling the API — it's making
> sure the thing never invents a price. The short version of the approach: the
> model must cite the catalog IDs it used, and a deterministic validator then
> re-checks every price, stock claim and order reference against those records.
> Anything it can't verify is discarded and the conversation stays flagged for a
> human. `npm run redteam` demonstrates it against 14 hallucination probes.
>
> Everything below the "Implementation notes" heading describes this branch.

A small exercise — about **1–2 hours**. Please don't spend more. If you run out of time, stop and note what you'd do next in the README. A small, finished result is better than a large, unfinished one.

## The task

Support agents handle customer messages in a shared inbox. Build a small version of it.

Messages arrive at a webhook (the included simulator plays the sender). You store them, group them into conversations per customer, sometimes reply automatically, and let an agent reply by hand.

This starter includes the project setup, sample data, and the simulator. You write the feature.

### Stubs to fill in

- `POST /api/webhook` (`server/src/index.ts`) — receives messages. Returns 501 until you implement it.
- `assistantReply()` (`server/src/assistant.ts`) — decides whether to auto-reply and what to say. Returns `null` until you implement it.
- `server/src/store.ts` — where you keep data (your choice, see below).
- `client/` — a React app; replace the placeholder page.

### Required

1. Implement `POST /api/webhook`: accept a message and store it in the right conversation (one per customer).
2. Add the API endpoints your UI needs (list conversations, get a thread, post a reply).
3. Show the conversation list (newest first, with a preview); open a thread to read it.
4. Let an agent send a reply; persist it and show it in the thread.
5. Implement `assistantReply()` so some messages get an automatic reply — e.g. a greeting, an order question, or a product question answered from the catalog. Two or three rules is enough; don't over-invest here.
6. Search conversations by customer name or message text.
7. Update this README (see "What to submit").

### One decision we leave to you

Messaging providers deliver the same message more than once (retries). The simulator can too — resend a message with the same `id`. Decide what should happen, implement it, and explain your choice in a sentence or two.

### Data store

Keep data wherever fits: an in-memory variable, a JSON file, or SQLite. No database server needed. Say what you chose and why.

## Optional (only if you have time)

None of these are required.

- Unread counts
- Optimistic UI when sending a reply
- Tests for the assistant
- Product recommendations from the catalog
- Loading / error / empty states

## Running it

Node 20+.

```bash
npm install
npm run dev     # API on :4000, app on http://localhost:5173
npm run seed    # load sample messages (run after dev is up)
```

Open http://localhost:5173. Calls to `/api/*` are proxied to the server.

Send a message:

```bash
npm run simulate -- --name "Emma Clark" --from "+15550001001" --text "do you have a desk lamp?"
```

Test a duplicate (same id twice):

```bash
npm run simulate -- --id dup-1 --text "hello"
npm run simulate -- --id dup-1 --text "hello"
```

See **Implementation notes → How to run** below for the API key and the test and
red-team commands.

## Implementation notes

### How to run

```bash
npm install
npm run dev              # API on :4000, app on http://localhost:5173
npm run seed             # load sample messages (run after dev is up)
npm test                 # 56 tests, no network, no API key needed
npm run redteam          # hallucination probes against the running app
```

Then open http://localhost:5173.

**This works with no API key.** The assistant falls back to its deterministic
rules, so you can clone, `npm install`, `npm run dev` and see the whole app.
Add a key to get the Gemini-powered replies.

### Enabling Gemini

**1. Get a key** from [Google AI Studio](https://aistudio.google.com/apikey) —
free tier is enough for this.

**2. Create `.env` in the project root:**

```bash
cp .env.example .env
```

**3. Put the key in it.** Open `.env` and fill in the value — no quotes, no
spaces around the `=`:

```ini
GEMINI_API_KEY=AQ.your_actual_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

**4. Restart the server** (`npm run dev`). `.env` is read at startup, so a key
added while it's running has no effect until you restart.

**5. Check the startup line** — the server prints which mode it is in. Key
found:

```
API server listening on http://localhost:4000
Assistant: Gemini (gemini-3.1-flash-lite) with grounding checks
```

No key (or it wasn't picked up):

```
API server listening on http://localhost:4000
Assistant: rule-based fallback (set GEMINI_API_KEY in .env to enable Gemini)
```

**6. Confirm it's really answering.** Send something the rules cannot answer —
they only ever quote price and stock, never colours:

```bash
npm run simulate -- --name "Test" --from "+15550009001" --text "what colors does the desk lamp come in?"
```

Within a few seconds the thread shows *"The Desk Lamp comes in white and black."*
with a `verified ▸ Desk Lamp` chip. If you instead get *"The Desk Lamp is $45.00
and in stock."*, the rules answered and the key isn't being picked up.

#### Notes on the key

- **`.env` is gitignored; `.env.example` is not.** Put the real key in `.env`
  only — anything in `.env.example` gets committed.
- Loaded via Node's native `--env-file-if-exists`, already wired into the `dev`
  and `redteam` scripts. No `dotenv` dependency. With no `.env` present Node
  prints `.env not found. Continuing without it.` — that's the flag working as
  intended, not an error.
- **Choosing a model** (`GEMINI_MODEL`, optional, defaults to
  `gemini-3.5-flash`). Measured live in July 2026:

  | Model | Result |
  |---|---|
  | `gemini-3.1-flash-lite` | Fast and correct on every probe — **recommended** |
  | `gemini-3.5-flash` | Works, but intermittent 503 "high demand"; ~6s+ under load |
  | `gemini-2.5-flash` | 404 — no longer available to newly created keys |

  A failed or slow call is not a broken app: it falls back to the rules, so the
  worst case is a plainer answer, never a wrong one.
- **Nothing is billed by `npm test`** — all 56 tests inject a fake model and
  never touch the network. Only `npm run dev` and `npm run redteam` make real
  calls.

### What's built

All seven required items, plus four of the optional ones: **optimistic UI**,
**loading / error / empty states**, **unread counts** (see "waiting" below), and
**tests for the assistant**.

The auto-reply is a **Gemini call grounded in a product catalog, a policy file
and an order book**, with a validator that re-checks every factual claim before
it can be stored, and an internal note in the thread when it declines to answer.
The rest of the app is a two-pane inbox: the one
question an agent asks all day is *who is still waiting on me*, so a conversation
whose **last message came from the customer** gets an amber rail, an amber
timestamp and a `NEEDS REPLY` flag, with a running `N waiting` count in the
header. That is the "unread count" in an honest form — derived from the data
rather than from a read/unread flag nothing would ever set.

### The assistant: how hallucination is prevented

```
server/src/assistant/
  index.ts       orchestrator — decides which layer answers, returns reply | decline
  data.ts        loads catalog/policies/orders; alias matching, order lookup
  prompt.ts      system instruction + the per-message user turn
  gemini.ts      SDK client, response schema, timeout/retry
  grounding.ts   the validator — every claim re-checked against the data
  rules.ts       deterministic fallback (the original assistant)
```

A prompt is a request, not a guarantee, so the design does not rely on one.

```
findOrder ─┐
           ├─→ prompt ─→ Gemini ─→ validate ─┬─ ok       → reply, with citations
catalog ───┘      │                          ├─ escalated → note (terminal)
                  │                          └─ rejected ─┐
                  └── no key / error / timeout ───────────┴─→ rules ─→ validate
                                                                  ├─ ok   → reply
                                                                  └─ none → note
```

**1. The model must cite its sources.** Structured output
(`responseMimeType: "application/json"` + a `responseSchema`, so decoding is
constrained) forces every reply into:

```ts
{ intent, needs_human, escalation_reason,
  cited_product_ids: string[], cited_order_number: string, reply: string }
```

`cited_product_ids` is the mechanism, not decoration: it makes each claim
attributable, and therefore checkable.

**2. Every claim is re-verified against the same data** (`grounding.ts`), before
anything is stored. Any failure discards the reply:

| # | Check | Kind |
|---|---|---|
| 1 | `needs_human`, or an empty reply | exact |
| 2 | Length, sentence count, no markdown, no links | exact |
| 3 | Every cited id exists in the catalog | exact |
| 4 | Every `$N.NN` matches a cited product, order line or policy fee, to the cent | exact |
| 5 | Any product named in the text but *not* cited | exact |
| 6 | Stock claims agree with `inStock` | heuristic |
| 7 | Order numbers and dates match the record actually supplied | exact |
| 8 | Duration claims ("3 to 5 business days") appear verbatim in the policies | heuristic |

Check 5 is the one that earns its keep. A reply can be entirely true about the
product it cited and still slip in *"you might also like the Power Bank"* — a
claim nothing verified. Uncited mention, discarded.

**3. Failure is closed — and escalation is terminal.** No key, an API error, a
timeout, or a rejected draft all fall through to the deterministic rules; if
those also decline, the assistant says nothing and the conversation keeps its
`NEEDS REPLY` flag. But the model *deliberately* handing off to a human
(`needs_human`) is a judgment, not a failure, and nothing answers past it —
live testing showed why: "my headphones caught fire, is that safe?" was
correctly escalated by the model, and the rules then matched "headphones" and
quoted the price at a safety complaint. The validator is deliberately strict
and will sometimes throw away a *correct* reply. That is the right direction to
fail — the cost is an escalation to a human who was going to read the thread
anyway, which is far cheaper than one confident wrong price.

**4. The rules are held to the same standard.** They go through the same
validator, which is how the red-team script caught the one real bug in this
work — see below.

**5. Declining is explained, not silent.** Staying quiet is right for the
*customer*, but it used to leave the **agent** with an unexplained gap: a
question, no answer, and no way to tell whether the assistant crashed or chose
to step back. Every decline now writes an internal note into the thread with the
reason:

```
┌─ customer ─────────────────────────┐
│ When will the backpack be back      │
│ in stock?                           │
└─────────────────────────────────────┘
  ⚠ ASSISTANT DECLINED          2m
    Restock date is not a field in
    the catalog.
    not sent to the customer
```

Notes are `sender: "system"` messages — internal only, never delivered. Because
they live in the thread, three derived signals in `listConversations` explicitly
skip them: `awaitingReply`, `preview` and `messageCount`. That is the load-
bearing detail. A note stored after a customer's question would otherwise make
the last message a non-customer one, clearing the amber `NEEDS REPLY` flag and
hiding the customer from the agent — the exact failure the "stay silent" design
was chosen to avoid. `server/src/store.test.ts` pins it.

All three decline paths are covered: a model escalation (the model's own words),
a validator rejection (*"quotes $119.00, which matches no cited record"* —
visible proof the gate fired), and an API failure (*"Assistant unavailable"*).
In rules-only mode with no API key nothing is written, since there is no
assistant decision to explain.

#### The prompt

`server/src/assistant/prompt.ts`, and the wording is load-bearing:

- **Closed world.** The supplied blocks are stated to be the ONLY sources of
  fact *and* to be complete, so "not in the catalog" means "we don't sell it"
  rather than "look harder".
- **Named absences.** A `<field_legend>` block explicitly lists the facts that
  do not exist — restock dates, per-item delivery estimates, discounts,
  competitor prices. Naming a gap gives the model a reason to escalate instead
  of filling it, and those absences are the red team's main targets.
- **Cheap escalation.** The prompt says a human reads every conversation, so
  escalating costs the customer minutes while a wrong answer costs their trust.
- **Declared verification.** The model is told a checker re-reads its reply and
  discards unverifiable claims. Knowing claims are checked visibly tightens them.
- **Refusal-heavy examples.** Half the few-shots are cases where the correct
  output is silence — including *"When will the backpack be back in stock?"*,
  where the **product exists but the fact does not**. That is the sharpest trap
  in this dataset, and the one a plain prompt fails most often.

Sent at `temperature: 0` so the same question yields the same answer.

#### Grounding data

- `data/catalog.json` — 28 products with description, specs, colours, stock
  count, warranty, rating, tags and **aliases**. Aliases fix a real bug in the
  original matcher: "do you have headphones?" never matched *Wireless
  Headphones*, because only full catalog names were checked.
- `data/policies.json` — shipping, returns, warranty, payment. Quotable values,
  so check 4 and check 8 have something exact to compare against.
- `data/orders.json` — six orders. Looked up **deterministically by number
  before the model runs**, and only the matched record is injected — so one
  customer's order can never appear in another's prompt. The number must be
  written in the message (we never guess which order someone means) and the
  order must belong to that conversation's phone number. Both are tested.

The full catalog and policies go into every prompt — measured at ~15,100
characters, roughly 4k tokens, for the 28-product catalog. At this size
that beats a retriever: a retriever that misses makes the model say "we don't
carry that" about something we sell. Gemini context caching on the static block
is the obvious optimisation if volume grew.

### Verification

`npm test` — 56 tests, no network (the model is injected):

- `grounding.test.ts` is the core suite. Each test hands the validator a draft a
  model plausibly could produce and asserts the fabricated ones are rejected:
  a wrong price, an invented product, an uncited mention, an inverted stock
  claim, a fabricated restock date, another customer's order number, an invented
  delivery window, markdown, links.
- `rules.test.ts` (11) — the original seven rule tests, plus alias matching and
  the three order-echo cases the red team forced (see below).
- `assistant.test.ts` (10) — which layer answers, that an escalation is terminal,
  that every decline carries a reason for the agent, and that a customer is only
  ever shown their own order.
- `store.test.ts` (4) — that an internal note never behaves like an answer:
  `awaitingReply` stays true, the preview stays the customer's message, the
  count excludes it. Uses an `INBOX_FILE` override so it writes to a temp file
  rather than the real inbox.
- `data.test.ts` (9) — corpus integrity: unique ids, no term claimed by two
  products, every alias resolving to its own product, order totals adding up.

`npm run redteam` sends 14 hallucination probes at the running app, then
re-checks whatever was stored. **This found a real bug.** The rules fallback
replied *"I've pulled up order #99999 and an agent will follow up"* for an order
that does not exist, and for an order belonging to a different customer — a
small lie, but the same kind as a wrong price. Two fixes: the rules now only
echo an order number they could actually find on that account, and **the rules'
output is now validated too**, so there is a single checkpoint rather than a
trusted path beside a checked one. Each `SILENT` probe also prints the reason
the assistant recorded, so the run doubles as a readout of *why* it declined.

Current result, live against Gemini:

```
2 escalated to a human, 12 answered and verified, 0 unverifiable.
No unverifiable claim was stored.
```

Two of those answers are worth reading, because they are the ones the rules
could never produce and the ones most likely to have been invented:

```
Do you sell drones?              -> We don't carry drones, sorry.
Do you have the desk lamp in pink? -> The Desk Lamp is available in white and
                                      black, but we do not carry it in pink.
```

(Rules-only, with no API key, the same run gives `3 escalated, 11 verified,
0 unverifiable` — duller answers, still nothing unverified.)

### Decisions & trade-offs

- **Data store — a JSON file behind a small interface.** All persistence lives in
  `server/src/store.ts`, which holds conversations in an in-memory `Map` and writes
  the whole set to `data/inbox.json` after each change. The rest of the app only calls
  the store's functions (`saveInbound`, `addReply`, `addNote`, `listConversations`, …),
  so the storage mechanism is a swappable seam — moving to SQLite/Postgres later means
  rewriting only this file. I chose a JSON file because the dataset is tiny, it needs
  no DB server, it survives restarts, and it's trivial to inspect. The path is
  overridable via `INBOX_FILE` so the tests don't write into the real inbox.
  _Trade-off:_ each write rewrites the whole file and there's no locking, so it isn't
  safe under concurrent writers — fine for a single-process demo, not for production.

- **Duplicate messages — idempotent on the message `id`.** Provider webhooks deliver
  at-least-once (a retry usually means our ACK was lost, not that the message changed),
  so `POST /api/webhook` treats the `id` as an idempotency key: if we've already stored
  it, the request is a no-op that returns `200 { duplicate: true }`. This prevents a
  duplicate line in the thread, a duplicate auto-reply, and a second paid model call.
  Returning 200 (not 4xx) also stops the provider's retry loop.

- **The webhook acknowledges before it thinks.** A model call takes a second or
  two; a provider webhook should never wait that long or it times out and retries
  a message we already have. So the webhook stores the message, returns
  `200 { queued: true }` in a few milliseconds, and generates the reply in the
  background — the UI already polls, so it appears on its own. Replies within one
  conversation are serialised through a promise chain so two fast messages can't
  produce interleaved answers, while different customers still run in parallel.

- **Model call settings, all measured rather than guessed.** `temperature: 0` and
  `topP: 1` so the same question gives the same answer. `thinkingLevel: LOW` on
  Gemini 3.x — every fact is already in the prompt, so this is an extractive task
  and the default thinking level just adds latency (the flag is 3.x-only, so it's
  guarded by a model-id check). **30s timeout, 3 attempts, backoff between them**:
  the original 8s was set by guesswork and every real call aborted, because even a
  trivial `gemini-3.5-flash` call measured ~6s under load and the API returns 503
  "high demand" in bursts. Nothing waits on that timeout — generation happens after
  the webhook has already ACKed — so it only bounds how long a thread sits
  unanswered before the rules take over.

- **Verify-then-send, rather than templates.** The stricter alternative is to let
  the model only classify intent and pick ids, then compose the sentence in code
  from templates — hallucination becomes structurally impossible. I chose
  verify-then-send because templates cannot handle a follow-up like *"and what
  colours does it come in?"*, and the validator closes most of the gap: a wrong
  fact still cannot reach a customer, it just costs an escalation instead of a
  template.

- **Conversations are keyed by customer phone (`from`)**, giving one conversation per
  customer as required. The customer's name is refreshed from the latest message.

- **Messages are ordered by timestamp, not arrival.** Providers don't guarantee order, so
  a delayed message is inserted in its chronological place and `lastMessageAt` only ever
  moves forward — otherwise one late delivery would drag a conversation down a
  "newest first" list. For the same reason an auto-reply is stamped just after the
  message it answers rather than at wall-clock time, so it stays beside its question.

- **The inbox polls every 4s** (paused while the tab is hidden) so messages arriving at
  the webhook show up without a reload. Polling is the right amount of machinery at this
  size; SSE or a websocket is the real answer once more than a handful of agents are on it.

- **UI — React + hand-written CSS, no webfont.** A CDN font would add a dependency and
  break the page for anyone offline, so the personality comes from pairing instead:
  system sans for prose, `ui-monospace` for every piece of data (times, phone numbers,
  counts, labels) so data reads as data. Two-pane inbox that collapses to a single pane
  under 820px; visible focus rings and `prefers-reduced-motion` respected. Assistant
  bubbles carry a small `verified ▸ Wireless Headphones` line showing what the reply
  was checked against, and a decline writes an amber full-width note giving the
  reason — both exist so the assistant's reasoning is visible to the agent rather
  than buried in a server log. The note is deliberately *not* bubble-shaped, so it
  can't be misread as something the customer saw.

- **A bug fixed on the way through.** `timestamp` was validated only as a non-empty
  *string*, so a malformed value made `Date.parse` return `NaN` and
  `new Date(NaN).toISOString()` throw — after the message had already been stored. It
  is now rejected with a 400 before anything is written.

- **Left out:** auth and multi-agent presence (no notion of who is handling a thread),
  read receipts, attachments, and pagination on the conversation list.

### Known limits

Worth being straight about what the validator does **not** catch:

- **A wholly invented product name with no price attached.** "We also stock the
  Northlight Drone" cannot be caught by matching against the catalog, because
  the catalog only knows what does exist. The prompt forbids it, the citation
  requirement discourages it, and any price attached to it is rejected — but the
  bare name is a prompt-level guarantee, not a checked one. Catching it properly
  means an entity-extraction pass, which is a second model call.
- **Checks 6 and 8 are heuristics** over natural language, not proofs. They read
  the claim and the cited set rather than parsing which clause attaches to which
  noun; a reply mixing an in-stock and an out-of-stock product is rejected rather
  than analysed. Checks 3, 4, 5 and 7 are exact.
- **Tone and helpfulness are unverified.** The gate checks facts, not whether the
  answer was useful.
- **The rules fallback is dumb, not wrong.** Ask it about megapixels on a phone
  case and it will quote you the phone case's price. It is verified, just not
  clever — which is the trade for working with no API key. (Gemini answers that
  one properly: *"The Phone Case is an accessory designed to protect your phone,
  so it does not have a camera or megapixels."*)
- **Internal notes are returned by the conversation API.** That is correct for an
  internal agent tool, which is all this is. If the same endpoint were ever served
  to customers, `sender: "system"` messages would have to be filtered server-side —
  the separation is currently by convention and by the `addNote`/`addReply` split,
  not enforced at the API boundary.

### AI usage

I used an AI coding assistant throughout: scaffolding the store, routes and React
components, expanding the catalog, drafting reply copy, and running review passes.

Where I changed its output — I chose the architecture (store behind a swappable
interface, idempotent webhook, ACK-then-generate, and the verify-then-send
grounding design), and corrected the calls it got wrong:

- Its first assistant implementation checked the greeting rule before the specific
  rules, so *"Hi, do you have the wireless headphones in stock?"* replied with a
  greeting instead of the stock answer.
- Its first pass stamped auto-replies at wall-clock time, which sorted them after
  backdated messages and made the waiting count read zero.
- Its markdown check banned `#`, which silently rejected every legitimate
  *"order #10432"* reply. Caught by the validator's own passing-case tests.
- It initially had the rules bypass the validator on the reasoning that
  rule-built replies are safe by construction. The red-team script disproved that
  within a minute.

Live testing against the real API found three more, each now pinned by a test:

- The validator discarded a **correct** reply — "you have 30 days to return an
  item" — because `policies.json` stores the window as `windowDays: 30` and the
  verbatim check searched the raw JSON for the words "30 days". Numeric duration
  fields are now rendered into the phrases a reply would naturally use.
- The 8-second model timeout was far too tight: measured live, even a tiny
  `gemini-3.5-flash` call took ~6s under load, and the API returns 503 "high
  demand" in bursts. Now 30s with backoff between attempts — nobody waits on it,
  since generation happens after the webhook has ACKed.
- The model's deliberate escalation used to fall through to the rules, which
  answered a safety complaint with a price quote (see "escalation is terminal"
  above).

Adding the decline notes turned up two more:

- The note text initially carried the log's `model escalated:` prefix into the
  UI, where the note is already labelled as a decline. It now shows the model's
  own words.
- Writing `store.test.ts` revealed the suite would have written its fixtures into
  the real `data/inbox.json`. Hence the `INBOX_FILE` override.

The remaining bugs listed are pinned by tests too. An earlier review pass also
surfaced races it fixed: a rollback that restored the wrong conversation's
thread, an unguarded search fetch that could show stale results, and a missing
in-flight lock that let a reply be sent twice.

### A note on `npm audit`

`npm audit` reports a moderate/high advisory in `esbuild`, pulled in by the starter's
`vite@5`. It is a dev-server-only issue with no effect on the built app, and the fix is a
breaking upgrade to `vite@8`, so I left the starter's dependency versions untouched.

### What's next

With more time: swap the JSON store for SQLite (a one-file change behind the store
interface); Gemini context caching on the static catalog block to cut per-call cost;
replace polling with SSE/websocket push; an entity-extraction pass to close the
invented-product-name gap above; agent identity on replies; filter `system` notes at
the API boundary rather than by convention; a "suggest a reply" button so an agent can
ask the assistant to draft into the composer instead of only auto-sending; and
pagination on the conversation list once it outgrows a screen.

## What to submit

1. A GitHub repo (fork/clone this one). Public, or private with an invite to GitHub user **@soroushahrari** (or email **soroush.ahrari@arcuscorp.it**).
2. This README, updated with:
   - How to run it, if different from above.
   - **Decisions & trade-offs** — include your duplicate-message decision, your data-store choice, and anything you left out.
   - **AI usage** — using AI tools is fine and encouraged. Briefly note what you used them for and where you changed their output.
   - **What's next** — what you'd add or improve with more time.

## What we look at

We care about how you work, not a perfect result.

- Whether it works.
- Backend: a clean, sensible data model and API.
- Frontend: a functional, easy-to-use UI.
- Readable, maintainable code.
- Clear explanations of your choices.

## Notes

- Aim for 1–2 hours.
- AI tools are allowed; just note how you used them.
- Questions are welcome — email **soroush.ahrari@arcuscorp.it**.
