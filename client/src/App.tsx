import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Conversation,
  ConversationSummary,
  Message,
} from "../../shared/types.js";
import * as api from "./api.js";
import { ConversationList } from "./components/ConversationList.js";
import { ThreadView } from "./components/ThreadView.js";
import { ReplyComposer } from "./components/ReplyComposer.js";
import { relativeTime } from "./time.js";

// How often the inbox re-checks for newly arrived messages. Polling keeps the
// client simple; a real deployment would push these over SSE or a websocket.
const POLL_MS = 4000;

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [search, setSearch] = useState("");

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Ignore list responses that are superseded by a newer request, so fast
  // typing can't leave stale results on screen.
  const listRequestRef = useRef(0);

  const refreshList = useCallback(
    async (term: string, { quiet = false } = {}) => {
      const requestId = ++listRequestRef.current;
      if (!quiet) setListLoading(true);
      try {
        const next = await api.listConversations(term);
        if (requestId !== listRequestRef.current) return; // superseded
        setConversations(next);
        setListError(null);
      } catch {
        if (requestId !== listRequestRef.current) return;
        setListError("Couldn't load conversations. Check the API server is running.");
      } finally {
        if (requestId === listRequestRef.current) setListLoading(false);
      }
    },
    []
  );

  // Debounce the search term, then load the list.
  useEffect(() => {
    const t = setTimeout(() => void refreshList(search), 200);
    return () => clearTimeout(t);
  }, [search, refreshList]);

  // Load the selected thread.
  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      return;
    }
    setThreadLoading(true);
    setSendError(null);
    let active = true;
    api
      .getConversation(selectedId)
      .then((c) => active && setThread(c))
      .catch(() => active && setThread(null))
      .finally(() => active && setThreadLoading(false));
    return () => {
      active = false;
    };
  }, [selectedId]);

  // Poll so messages arriving at the webhook show up without a reload.
  // Pauses while the tab is hidden or a reply is in flight.
  useEffect(() => {
    const tick = () => {
      if (document.hidden || sending) return;
      void refreshList(search, { quiet: true });
      if (selectedId) {
        api
          .getConversation(selectedId)
          .then((fresh) => setThread((cur) => (cur?.id === fresh.id ? fresh : cur)))
          .catch(() => {
            /* transient; the next tick retries */
          });
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [search, selectedId, sending, refreshList]);

  async function handleSend(text: string) {
    const conversationId = selectedId;
    if (!conversationId || !thread || sending) return;
    setSendError(null);
    setSending(true);

    // Optimistic: show the reply immediately with a temporary id.
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversationId,
      sender: "agent",
      text,
      timestamp: new Date().toISOString(),
    };
    const previousMessages = thread.messages;
    setThread((cur) =>
      cur && cur.id === conversationId
        ? { ...cur, messages: [...cur.messages, optimistic], lastMessageAt: optimistic.timestamp }
        : cur
    );

    try {
      const saved = await api.sendReply(conversationId, text);
      // Only touch the thread if the agent is still looking at it.
      setThread((cur) =>
        cur && cur.id === conversationId
          ? { ...cur, messages: cur.messages.map((m) => (m.id === optimistic.id ? saved : m)) }
          : cur
      );
      void refreshList(search, { quiet: true });
    } catch {
      // Roll back only this conversation — the agent may have moved on.
      setThread((cur) =>
        cur && cur.id === conversationId ? { ...cur, messages: previousMessages } : cur
      );
      setSendError("Couldn't send that reply. Try again.");
    } finally {
      setSending(false);
    }
  }

  const waiting = conversations.filter((c) => c.awaitingReply).length;
  const showEmptyInbox = !listLoading && conversations.length === 0 && !search;

  return (
    <div className={`app${selectedId ? " has-selection" : ""}`}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <h1>Inbox</h1>
            {waiting > 0 && (
              <span className="waiting-count" title="Conversations with no reply yet">
                {waiting} waiting
              </span>
            )}
          </div>
          <input
            className="search"
            type="search"
            placeholder="Search name or message"
            aria-label="Search conversations by name or message"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </header>

        <div className="sidebar-body">
          {listError ? (
            <div className="notice error">
              <p>{listError}</p>
              <button className="link" onClick={() => void refreshList(search)}>
                Try again
              </button>
            </div>
          ) : listLoading && conversations.length === 0 ? (
            <p className="notice">Loading conversations…</p>
          ) : showEmptyInbox ? (
            <div className="notice">
              <p>No conversations yet.</p>
              <p className="notice-hint">
                Run <code>npm run seed</code> to load the sample messages.
              </p>
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
      </aside>

      <main className="main">
        {!selectedId ? (
          <div className="placeholder">
            <p>Pick a conversation to read it.</p>
          </div>
        ) : threadLoading && !thread ? (
          <div className="placeholder">
            <p>Loading conversation…</p>
          </div>
        ) : !thread ? (
          <div className="placeholder">
            <p>Couldn't load that conversation.</p>
            <button className="link" onClick={() => setSelectedId(null)}>
              Back to inbox
            </button>
          </div>
        ) : (
          <>
            <header className="thread-header">
              <button
                className="back link"
                onClick={() => setSelectedId(null)}
                aria-label="Back to inbox"
              >
                ← Inbox
              </button>
              <div>
                <h2>{thread.customerName}</h2>
                <p className="thread-meta">
                  <span className="mono">{thread.customerPhone}</span>
                  <span className="dot">·</span>
                  <span>last message {relativeTime(thread.lastMessageAt)}</span>
                </p>
              </div>
            </header>

            <ThreadView conversation={thread} />

            {sendError && <p className="notice error inline">{sendError}</p>}
            <ReplyComposer onSend={handleSend} sending={sending} />
          </>
        )}
      </main>
    </div>
  );
}
