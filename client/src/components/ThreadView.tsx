import { useEffect, useRef } from "react";
import catalog from "../../../data/catalog.json";
import type { Conversation, Message, Sender } from "../../../shared/types.js";
import { relativeTime } from "../time.js";

const SENDER_LABEL: Record<Sender, string> = {
  customer: "Customer",
  assistant: "Assistant · auto",
  agent: "You",
  system: "Assistant declined",
};

// Citations are stored as catalog ids; the agent wants to read product names.
const PRODUCT_NAMES: Record<string, string> = Object.fromEntries(
  (catalog as { id: string; name: string }[]).map((p) => [p.id, p.name])
);

function hasCitations(m: Message): boolean {
  return Boolean(m.citations && (m.citations.productIds.length > 0 || m.citations.orderNumber));
}

interface Props {
  conversation: Conversation;
}

export function ThreadView({ conversation }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastMessageId = conversation.messages[conversation.messages.length - 1]?.id;

  // Keep the newest message in view when opening a thread or on a new message.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.id, lastMessageId]);

  return (
    <div className="thread" role="log" aria-label="Conversation messages">
      {conversation.messages.map((m) =>
        // An internal note, not part of the conversation: rendered full width
        // and unlike a bubble so it can't be mistaken for something the
        // customer saw.
        m.sender === "system" ? (
          <aside key={m.id} className="note-row">
            <p className="note-head mono">
              <span className="note-label">⚠ {SENDER_LABEL.system}</span>
              <time dateTime={m.timestamp}>{relativeTime(m.timestamp)}</time>
            </p>
            <p className="note-text">{m.text}</p>
            <p className="note-foot mono">not sent to the customer</p>
          </aside>
        ) : (
        <article key={m.id} className={`bubble-row ${m.sender}`}>
          <div className="bubble">
            <header className="bubble-meta">
              <span className="bubble-sender">{SENDER_LABEL[m.sender]}</span>
              <time className="mono" dateTime={m.timestamp}>
                {relativeTime(m.timestamp)}
              </time>
            </header>
            <p className="bubble-text">{m.text}</p>
            {m.sender === "assistant" && hasCitations(m) && (
              // What the reply was checked against before it was allowed to
              // send — the grounding check made visible to the agent.
              <p className="bubble-citations mono">
                <span className="citation-label">verified</span>
                {m.citations?.orderNumber && (
                  <span className="citation">order #{m.citations.orderNumber}</span>
                )}
                {m.citations?.productIds.map((id) => (
                  <span key={id} className="citation">
                    {PRODUCT_NAMES[id] ?? id}
                  </span>
                ))}
              </p>
            )}
          </div>
        </article>
        )
      )}
      <div ref={endRef} />
    </div>
  );
}
