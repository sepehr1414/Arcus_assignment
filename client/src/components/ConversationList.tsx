import type { ConversationSummary } from "../../../shared/types.js";
import { relativeTime } from "../time.js";

interface Props {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ conversations, selectedId, onSelect }: Props) {
  if (conversations.length === 0) {
    return <p className="notice">No conversations match that search.</p>;
  }

  return (
    <ul className="conversation-list">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={[
              "conversation-row",
              c.id === selectedId ? "selected" : "",
              c.awaitingReply ? "awaiting" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelect(c.id)}
            aria-current={c.id === selectedId}
          >
            <span className="row-head">
              <span className="row-name">{c.customerName}</span>
              <span className="row-time mono">{relativeTime(c.lastMessageAt)}</span>
            </span>
            <span className="row-preview">{c.preview}</span>
            {c.awaitingReply && <span className="row-flag">Needs reply</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
