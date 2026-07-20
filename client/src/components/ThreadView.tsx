import { useEffect, useRef } from "react";
import type { Conversation, Sender } from "../../../shared/types.js";
import { relativeTime } from "../time.js";

const SENDER_LABEL: Record<Sender, string> = {
  customer: "Customer",
  assistant: "Assistant · auto",
  agent: "You",
};

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
      {conversation.messages.map((m) => (
        <article key={m.id} className={`bubble-row ${m.sender}`}>
          <div className="bubble">
            <header className="bubble-meta">
              <span className="bubble-sender">{SENDER_LABEL[m.sender]}</span>
              <time className="mono" dateTime={m.timestamp}>
                {relativeTime(m.timestamp)}
              </time>
            </header>
            <p className="bubble-text">{m.text}</p>
          </div>
        </article>
      ))}
      <div ref={endRef} />
    </div>
  );
}
