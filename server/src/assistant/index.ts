// The assistant.
//
//   findOrder ─┐
//              ├─→ buildUserTurn ─→ Gemini ─→ validate ─┬─ ok   → grounded reply
//   catalog ───┘        │                               └─ fail ─┐
//                       └── no key / error / timeout ────────────┴─→ rules → reply | null
//
// Two layers, and the model is only ever trusted through the second one. If the
// LLM path produces nothing usable we fall back to the deterministic rules, and
// if those also decline we stay silent and the conversation keeps its "needs
// reply" flag for a human.

import type {
  Citations,
  Conversation,
  InboundMessage,
} from "../../../shared/types.js";
import { findOrder } from "./data.js";
import { createGeminiClient, type LlmClient } from "./gemini.js";
import { validate } from "./grounding.js";
import { buildUserTurn } from "./prompt.js";
import { rulesReply } from "./rules.js";

export interface AutoReply {
  text: string;
  citations?: Citations;
}

/**
 * What the assistant decided.
 *
 * `declined` carries the reason so the agent can see it in the thread rather
 * than only in a server log. `null` means there is nothing to say *and* nothing
 * to explain — which is only the case when no model is configured at all.
 */
export type AssistantOutcome =
  | ({ kind: "reply" } & AutoReply)
  | { kind: "declined"; reason: string }
  | null;

// Built once. Null when GEMINI_API_KEY is unset, which is the signal to run
// rules-only — a fresh checkout works with no configuration.
let client: LlmClient | null | undefined;

function defaultClient(): LlmClient | null {
  if (client === undefined) client = createGeminiClient();
  return client;
}

/** Test seam: inject a fake model, or null to force the rules path. */
export function setLlmClient(next: LlmClient | null): void {
  client = next;
}

export async function generateAutoReply(
  conversation: Conversation,
  message: InboundMessage,
  llm: LlmClient | null = defaultClient()
): Promise<AssistantOutcome> {
  const order = findOrder(message.text, conversation.id);

  // Why the model path produced nothing, kept so it can be shown to the agent
  // if the rules don't rescue the message.
  let declineReason: string | null = null;

  if (llm) {
    try {
      const draft = await llm(buildUserTurn({ conversation, message, order }));
      const result = validate(draft, { order });

      if (result.ok) {
        return {
          kind: "reply",
          text: result.text,
          citations: {
            productIds: result.productIds,
            ...(result.orderNumber ? { orderNumber: result.orderNumber } : {}),
          },
        };
      }

      // Every rejection is logged: this is the record that the gate is doing
      // work, and the first place to look when the assistant goes quiet.
      console.log(
        `[assistant] discarded reply for ${conversation.id}: ${result.reason}` +
          (draft.reply ? `\n           draft: ${JSON.stringify(draft.reply)}` : "")
      );

      declineReason = result.reason;

      // The model deliberately handing off to a human is a judgment, not a
      // failure — the rules must not answer past it. Found live: "my headphones
      // caught fire" was correctly escalated by the model, then the rules
      // matched "headphones" and quoted the price at a safety complaint.
      if (result.escalated) {
        // The raw reason, not `result.reason` — that carries a "model
        // escalated:" prefix meant for the log, and the note is already
        // labelled as a decline in the UI.
        return {
          kind: "declined",
          reason: draft.escalation_reason.trim() || "The assistant left this for a human.",
        };
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[assistant] Gemini call failed for ${conversation.id}, falling back to rules.`,
        detail
      );
      declineReason = "Assistant unavailable (the model call failed).";
    }
  }

  const fallback = rulesReply(message);
  if (!fallback) {
    // Nothing to say. If the model had a reason, the agent should see it;
    // otherwise (rules-only mode, no key) there is no decision to explain.
    return declineReason ? { kind: "declined", reason: declineReason } : null;
  }

  // The rules go through the same gate. They build their replies out of catalog
  // records so they *should* always pass — but "should" is how the order-number
  // bug got in, and a single checkpoint is a much easier guarantee to state:
  // nothing reaches a customer without being verified against the data.
  const checked = validate(
    {
      intent: "other",
      needs_human: false,
      escalation_reason: "",
      cited_product_ids: fallback.productIds,
      cited_order_number: fallback.orderNumber ?? "",
      reply: fallback.text,
    },
    { order }
  );

  if (!checked.ok) {
    console.log(
      `[assistant] discarded rule reply for ${conversation.id}: ${checked.reason}`
    );
    // A rule reply failing the gate means the rules are wrong, not just quiet —
    // always worth showing, even in rules-only mode.
    return { kind: "declined", reason: checked.reason };
  }

  return {
    kind: "reply",
    text: checked.text,
    ...(checked.productIds.length || checked.orderNumber
      ? {
          citations: {
            productIds: checked.productIds,
            ...(checked.orderNumber ? { orderNumber: checked.orderNumber } : {}),
          },
        }
      : {}),
  };
}
