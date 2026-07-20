// Conversation storage.
//
// Choice: a JSON file (data/inbox.json) held behind this small interface. The
// whole app talks to the functions below and never touches the file directly,
// so the persistence mechanism is a swappable seam — moving to SQLite/Postgres
// later means rewriting only this module. A JSON file is right-sized for the
// scope (tiny dataset, no DB server), survives restarts, and is easy to inspect.
//
// Trade-off: writes rewrite the whole file and there is no locking, so this is
// not safe under concurrent writers. Fine for a single-process demo; noted in
// the README.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Conversation,
  ConversationSummary,
  InboundMessage,
  Message,
  Sender,
} from "../../shared/types.js";

const DATA_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/inbox.json"
);

// conversationId (customer phone) -> Conversation
const conversations = new Map<string, Conversation>();
// every message id we have stored, for O(1) duplicate detection
const seenMessageIds = new Set<string>();

function load(): void {
  if (!existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as Conversation[];
    for (const convo of parsed) {
      conversations.set(convo.id, convo);
      for (const msg of convo.messages) seenMessageIds.add(msg.id);
    }
  } catch (err) {
    console.error(`Could not read ${DATA_FILE}, starting empty.`, err);
  }
}

function persist(): void {
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify([...conversations.values()], null, 2));
  } catch (err) {
    console.error(`Could not write ${DATA_FILE}.`, err);
  }
}

load();

/** Has a message with this provider id already been stored? */
export function hasMessage(id: string): boolean {
  return seenMessageIds.has(id);
}

/**
 * Store an inbound customer message in its conversation (one per customer,
 * keyed by `from`), creating the conversation if needed. This is the single
 * source of truth for de-duplication: a message id we've already stored is a
 * no-op, and the caller is told so via `duplicate`.
 */
export function saveInbound(msg: InboundMessage): {
  conversation: Conversation | undefined;
  duplicate: boolean;
} {
  // A duplicate must not mutate anything — not even create a conversation.
  if (hasMessage(msg.id)) {
    return { conversation: conversations.get(msg.from), duplicate: true };
  }

  const conversation = conversations.get(msg.from) ?? createConversation(msg);
  conversation.customerName = msg.customerName; // keep the latest known name
  insertMessage(conversation, {
    id: msg.id,
    conversationId: conversation.id,
    sender: "customer",
    text: msg.text,
    timestamp: msg.timestamp,
  });
  seenMessageIds.add(msg.id);
  persist();
  return { conversation, duplicate: false };
}

/**
 * Insert a message in timestamp order and advance lastMessageAt.
 * Providers don't guarantee ordering, so a late-arriving older message must
 * neither land at the end of the thread nor drag the conversation down the
 * newest-first list.
 */
function insertMessage(conversation: Conversation, message: Message): void {
  const at = conversation.messages.findIndex(
    (m) => m.timestamp > message.timestamp
  );
  if (at === -1) conversation.messages.push(message);
  else conversation.messages.splice(at, 0, message);

  if (message.timestamp > conversation.lastMessageAt) {
    conversation.lastMessageAt = message.timestamp;
  }
}

function createConversation(msg: InboundMessage): Conversation {
  const conversation: Conversation = {
    id: msg.from,
    customerName: msg.customerName,
    customerPhone: msg.from,
    messages: [],
    lastMessageAt: msg.timestamp,
  };
  conversations.set(conversation.id, conversation);
  return conversation;
}

/**
 * Append an assistant or agent reply to an existing conversation.
 *
 * `at` lets the caller place the reply in conversation time rather than wall
 * time: an auto-reply belongs immediately after the message it answers, which
 * matters when messages arrive with older timestamps than "now".
 */
export function addReply(
  conversationId: string,
  text: string,
  sender: Extract<Sender, "assistant" | "agent">,
  at?: string
): Message | undefined {
  const conversation = conversations.get(conversationId);
  if (!conversation) return undefined;

  const message: Message = {
    id: `${sender}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    conversationId,
    sender,
    text,
    timestamp: at ?? new Date().toISOString(),
  };
  insertMessage(conversation, message);
  seenMessageIds.add(message.id);
  persist();
  return message;
}

/** All conversations, newest first, optionally filtered by name or message text. */
export function listConversations(search?: string): ConversationSummary[] {
  const term = search?.trim().toLowerCase();
  return [...conversations.values()]
    .filter((c) => {
      if (!term) return true;
      return (
        c.customerName.toLowerCase().includes(term) ||
        c.messages.some((m) => m.text.toLowerCase().includes(term))
      );
    })
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        id: c.id,
        customerName: c.customerName,
        customerPhone: c.customerPhone,
        preview: last?.text ?? "",
        lastMessageAt: c.lastMessageAt,
        messageCount: c.messages.length,
        // The customer spoke last, so nobody has answered them yet.
        awaitingReply: last?.sender === "customer",
      };
    });
}

/** One full conversation thread. */
export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}
