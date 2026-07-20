import express from "express";
import type { InboundMessage } from "../../shared/types.js";
import { assistantReply } from "./assistant.js";
import {
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

  // The store owns the de-duplication rule; a duplicate stores nothing and
  // must not trigger a second auto-reply.
  const inbound = message as InboundMessage;
  const { duplicate } = saveInbound(inbound);
  if (duplicate) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const reply = assistantReply(inbound);
  if (reply) {
    // Place the auto-reply directly after the message it answers, so a message
    // that arrives with an older timestamp doesn't leave its reply at the end.
    const replyAt = new Date(Date.parse(inbound.timestamp) + 1).toISOString();
    addReply(inbound.from, reply, "assistant", replyAt);
  }

  return res.status(200).json({ ok: true, duplicate: false, autoReplied: reply !== null });
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
});
