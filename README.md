# Take-Home: Conversation Inbox

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

Until you implement the webhook it returns 501 — that's expected.

## Implementation notes

### How to run

Unchanged from above, plus tests:

```bash
npm install
npm run dev     # API on :4000, app on http://localhost:5173
npm run seed    # load sample messages (run after dev is up)
npm test        # assistant rule tests
```

Then open http://localhost:5173.

### What's built

All seven required items, plus four of the optional ones: **optimistic UI**,
**loading / error / empty states**, **unread counts** (see "waiting" below), and
**tests for the assistant**. Product recommendations were deliberately skipped to keep
the exercise inside its time box.

The UI is a two-pane inbox. The one question an agent asks all day is *who is still
waiting on me*, so that is what the design puts first: a conversation whose **last
message came from the customer** is unanswered, and it gets an amber rail, an amber
timestamp, and a `NEEDS REPLY` flag, with a running `N waiting` count in the header.
That is the "unread count" in an honest form — it is derived from the data rather than
from a read/unread flag nothing would ever set. Everything else is deliberately quiet:
one brand colour (petrol) for the agent's own voice, one signal colour (amber) that is
used for nothing else.

### Decisions & trade-offs

- **Data store — a JSON file behind a small interface.** All persistence lives in
  `server/src/store.ts`, which holds conversations in an in-memory `Map` and writes
  the whole set to `data/inbox.json` after each change. The rest of the app only calls
  the store's functions (`saveInbound`, `addReply`, `listConversations`, …), so the
  storage mechanism is a swappable seam — moving to SQLite/Postgres later means
  rewriting only this file. I chose a JSON file because the dataset is tiny, it needs
  no DB server, it survives restarts, and it's trivial to inspect.
  _Trade-off:_ each write rewrites the whole file and there's no locking, so it isn't
  safe under concurrent writers — fine for a single-process demo, not for production.

- **Duplicate messages — idempotent on the message `id`.** Provider webhooks deliver
  at-least-once (a retry usually means our ACK was lost, not that the message changed),
  so `POST /api/webhook` treats the `id` as an idempotency key: if we've already stored
  it, the request is a no-op that returns `200 { duplicate: true }`. This prevents both
  a duplicate line in the thread and a duplicate auto-reply. Returning 200 (not 4xx)
  also stops the provider's retry loop.

- **Conversations are keyed by customer phone (`from`)**, giving one conversation per
  customer as required. The customer's name is refreshed from the latest message.

- **Messages are ordered by timestamp, not arrival.** Providers don't guarantee order, so
  a delayed message is inserted in its chronological place and `lastMessageAt` only ever
  moves forward — otherwise one late delivery would drag a conversation down a
  "newest first" list. For the same reason an auto-reply is stamped just after the
  message it answers rather than at wall-clock time, so it stays beside its question.

- **Assistant — three deterministic rules** in `server/src/assistant.ts`, first match
  wins: an order-status question (echoes the order number), a product/stock question
  answered from `data/catalog.json`, then a greeting/thanks. The specific rules are
  checked *before* the greeting on purpose — customers usually open with "Hi, do you have
  X?", and the useful answer is the one about X. Anything else returns `null` and is left
  for a human. `npm test` covers each rule and both ordering cases.

- **The inbox polls every 4s** (paused while the tab is hidden) so messages arriving at
  the webhook show up without a reload. Polling is the right amount of machinery at this
  size; SSE or a websocket is the real answer once more than a handful of agents are on it.

- **UI — React + hand-written CSS, no webfont.** A CDN font would add a dependency and
  break the page for anyone offline, so the personality comes from pairing instead:
  system sans for prose, `ui-monospace` for every piece of data (times, phone numbers,
  counts, labels) so data reads as data. Two-pane inbox that collapses to a single pane
  under 820px; visible focus rings and `prefers-reduced-motion` respected.

- **Left out:** auth and multi-agent presence (no notion of who is handling a thread),
  read receipts, attachments, pagination on the conversation list, and product
  recommendations.

### AI usage

I used an AI coding assistant throughout: scaffolding the store, routes and
React components, drafting the assistant's reply copy and running a
review pass over the diff.

Where I changed its output — I chose the architecture (store behind a swappable
interface, idempotent webhook, the data model) and corrected the calls it got wrong. Two
worth naming: its first assistant implementation checked the greeting rule first, so "Hi,
do you have the wireless headphones in stock?" replied with a greeting instead of the
stock answer; and its first pass stamped auto-replies at wall-clock time, which sorted
them after backdated messages and made the waiting count read zero. Both are now pinned
by tests. The review pass also surfaced races I had it fix: a rollback that restored the
wrong conversation's thread, an unguarded search fetch that could show stale results, and
a missing in-flight lock that let a reply be sent twice.

### A note on `npm audit`

`npm audit` reports a moderate/high advisory in `esbuild`, pulled in by the starter's
`vite@5`. It is a dev-server-only issue with no effect on the built app, and the fix is a
breaking upgrade to `vite@8`, so I left the starter's dependency versions untouched.

### What's next

With more time: swap the JSON store for SQLite (a one-file change behind the store
interface), replace polling with SSE/websocket push, paginate the conversation list once
it outgrows a screen, add agent identity so a thread shows who replied, and catalog-driven
product recommendations.

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
