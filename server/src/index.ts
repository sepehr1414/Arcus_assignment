import express from "express";
import type { InboundMessage } from "../../shared/types.js";
import { generateAutoReply } from "./assistant/index.js";
import {
  addNote,
  addReply,
  getConversation,
  listConversations,
  saveInbound,
} from "./store.js";

const app = express();
app.use(express.json());

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// One promise chain per conversation. Two messages from the same customer
// arriving back to back would otherwise have their auto-replies generated
// concurrently and land interleaved; this keeps a conversation's replies in the
// order its messages arrived, while different customers still run in parallel.
const generating = new Map<string, Promise<void>>();

/**
 * Generate and store an auto-reply for a message that has already been saved.
 *
 * Runs after the webhook has responded, so a slow model never delays the
 * provider's ACK. The client polls, so the reply appears on its own.
 */
function queueAutoReply(inbound: InboundMessage): void {
  const previous = generating.get(inbound.from) ?? Promise.resolve();

  const next = previous
    .then(async () => {
      const conversation = getConversation(inbound.from);
      if (!conversation) return;

      const outcome = await generateAutoReply(conversation, inbound);
      if (!outcome) return; // no assistant configured — nothing to say or explain

      // Place the reply (or the note) directly after the message it responds to,
      // so a message that arrives with an older timestamp doesn't leave it at
      // the end of the thread.
      const at = new Date(Date.parse(inbound.timestamp) + 1).toISOString();

      if (outcome.kind === "reply") {
        addReply(inbound.from, outcome.text, "assistant", at, outcome.citations);
      } else {
        // The assistant stepped back. Record why, for the agent who now has to
        // answer — this is an internal note, never sent to the customer, and it
        // leaves the conversation flagged as still needing a reply.
        addNote(inbound.from, outcome.reason, at);
      }
    })
    .catch((err) => {
      console.error(`[webhook] auto-reply failed for ${inbound.from}.`, err);
    })
    .finally(() => {
      // Drop the chain once it is the last one, so the map doesn't grow forever.
      if (generating.get(inbound.from) === next) generating.delete(inbound.from);
    });

  generating.set(inbound.from, next);
}

// Receives inbound messages from the simulator (and, in real life, a provider).
//
// Duplicate handling: provider webhooks are at-least-once, so this endpoint is
// idempotent on the message id. A repeat id is a no-op that returns 200 with
// { duplicate: true } — no second stored message and no second auto-reply.
app.post("/api/webhook", (req, res) => {
  const message = req.body as Partial<InboundMessage>;

  if (
    !isNonEmptyString(message.id) ||
    !isNonEmptyString(message.from) ||
    !isNonEmptyString(message.customerName) ||
    !isNonEmptyString(message.text) ||
    !isNonEmptyString(message.timestamp)
  ) {
    return res.status(400).json({ ok: false, error: "invalid message payload" });
  }

  // The timestamp has to be a real date, not just a string: it drives the
  // thread ordering and the auto-reply's own timestamp, and an unparseable one
  // would throw further down — after the message had already been stored.
  if (Number.isNaN(Date.parse(message.timestamp))) {
    return res.status(400).json({ ok: false, error: "timestamp must be an ISO 8601 date" });
  }

  // The store owns the de-duplication rule; a duplicate stores nothing and
  // must not trigger a second auto-reply.
  const inbound = message as InboundMessage;
  const { duplicate } = saveInbound(inbound);
  if (duplicate) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // Acknowledge immediately, then think. A support message may take a couple of
  // seconds to answer; a provider webhook should never wait that long, or it
  // times out and retries a message we already have.
  queueAutoReply(inbound);
  return res.status(200).json({ ok: true, duplicate: false, queued: true });
});

// List conversations (newest first), optionally filtered by ?search=.
app.get("/api/conversations", (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json(listConversations(search));
});

// One conversation thread.
app.get("/api/conversations/:id", (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ ok: false, error: "not found" });
  res.json(conversation);
});

// Agent reply, entered by hand in the UI.
app.post("/api/conversations/:id/reply", (req, res) => {
  const text = (req.body as { text?: unknown }).text;
  if (!isNonEmptyString(text)) {
    return res.status(400).json({ ok: false, error: "text is required" });
  }

  const message = addReply(req.params.id, text, "agent");
  if (!message) return res.status(404).json({ ok: false, error: "not found" });
  res.status(201).json(message);
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
  console.log(
    process.env.GEMINI_API_KEY
      ? `Assistant: Gemini (${process.env.GEMINI_MODEL ?? "gemini-3.5-flash"}) with grounding checks`
      : "Assistant: rule-based fallback (set GEMINI_API_KEY in .env to enable Gemini)"
  );
});
