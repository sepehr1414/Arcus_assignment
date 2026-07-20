import type {
  Conversation,
  ConversationSummary,
  Message,
} from "../../shared/types.js";

// The Vite dev server proxies /api/* to the Node server, so relative URLs work.

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export function listConversations(search?: string): Promise<ConversationSummary[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return fetch(`/api/conversations${qs}`).then((r) => json<ConversationSummary[]>(r));
}

export function getConversation(id: string): Promise<Conversation> {
  return fetch(`/api/conversations/${encodeURIComponent(id)}`).then((r) =>
    json<Conversation>(r)
  );
}

export function sendReply(id: string, text: string): Promise<Message> {
  return fetch(`/api/conversations/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).then((r) => json<Message>(r));
}
