import { useState } from "react";

interface Props {
  onSend: (text: string) => void;
  sending: boolean;
}

export function ReplyComposer({ onSend, sending }: Props) {
  const [text, setText] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <form className="composer" onSubmit={submit}>
      <input
        type="text"
        placeholder="Write a reply"
        aria-label="Write a reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={sending}
      />
      <button type="submit" disabled={sending || text.trim().length === 0}>
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
