// The orchestrator: which layer answers, and what happens when a layer fails.
// The model is injected, so none of this touches the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Conversation, InboundMessage } from "../../../shared/types.js";
import {
  generateAutoReply,
  type AssistantOutcome,
  type AutoReply,
} from "./index.js";
import type { AssistantDraft, LlmClient } from "./gemini.js";

function conversation(text: string, phone = "+15550001001"): {
  conversation: Conversation;
  message: InboundMessage;
} {
  const message: InboundMessage = {
    id: "m-1",
    from: phone,
    customerName: "Emma Clark",
    text,
    timestamp: "2026-07-20T10:00:00.000Z",
  };
  return {
    message,
    conversation: {
      id: phone,
      customerName: "Emma Clark",
      customerPhone: phone,
      messages: [
        {
          id: "m-1",
          conversationId: phone,
          sender: "customer",
          text,
          timestamp: message.timestamp,
        },
      ],
      lastMessageAt: message.timestamp,
    },
  };
}

function fakeLlm(over: Partial<AssistantDraft>): LlmClient {
  return async () => ({
    intent: "product_question",
    needs_human: false,
    escalation_reason: "",
    cited_product_ids: [],
    cited_order_number: "",
    reply: "",
    ...over,
  });
}

/** Narrow to a sent reply, failing loudly if the assistant declined instead. */
function replyOf(outcome: AssistantOutcome): AutoReply {
  assert.ok(outcome && outcome.kind === "reply", `expected a reply, got ${JSON.stringify(outcome)}`);
  return outcome;
}

/** Narrow to a decline, returning the reason shown to the agent. */
function declineOf(outcome: AssistantOutcome): string {
  assert.ok(
    outcome && outcome.kind === "declined",
    `expected a decline, got ${JSON.stringify(outcome)}`
  );
  return outcome.reason;
}

test("uses a validated model reply and records its citations", async () => {
  const { conversation: c, message } = conversation("do you have headphones?");
  const reply = replyOf(
    await generateAutoReply(
      c,
      message,
      fakeLlm({
        cited_product_ids: ["p-001"],
        reply: "Yes, the Wireless Headphones are $129.00 and in stock.",
      })
    )
  );
  assert.equal(reply.text, "Yes, the Wireless Headphones are $129.00 and in stock.");
  assert.deepEqual(reply.citations?.productIds, ["p-001"]);
});

test("falls back to the rules when the model's reply fails the grounding check", async () => {
  const { conversation: c, message } = conversation("do you have a desk lamp?");
  // A wrong price must never reach the customer; the rules answer instead.
  const reply = replyOf(
    await generateAutoReply(
      c,
      message,
      fakeLlm({ cited_product_ids: ["p-004"], reply: "The Desk Lamp is $9.99 and in stock." })
    )
  );
  assert.equal(reply.text, "The Desk Lamp is $45.00 and in stock.");
});

test("falls back to the rules when the model throws", async () => {
  const { conversation: c, message } = conversation("do you have a desk lamp?");
  const reply = replyOf(
    await generateAutoReply(c, message, async () => {
      throw new Error("network down");
    })
  );
  assert.equal(reply.text, "The Desk Lamp is $45.00 and in stock.");
});

test("runs rules-only when no model is configured", async () => {
  const { conversation: c, message } = conversation("Hello!");
  assert.match(replyOf(await generateAutoReply(c, message, null)).text, /^Hi Emma!/);
});

test("the model's escalation is terminal — the rules must not answer past it", async () => {
  // "My headphones caught fire" was correctly escalated by the model live,
  // and the rules then matched "headphones" and quoted the price at a safety
  // complaint. An escalation is a judgment, not a failure to route around.
  const { conversation: c, message } = conversation("My headphones caught fire, is that safe?");
  const reason = declineOf(
    await generateAutoReply(
      c,
      message,
      fakeLlm({ needs_human: true, escalation_reason: "Safety issue; a human must handle this." })
    )
  );
  // The agent is told why, rather than finding an unexplained gap — and the
  // note carries the model's own words, without the log's "model escalated:"
  // prefix.
  assert.equal(reason, "Safety issue; a human must handle this.");
});

test("declines with the model's own reason when neither layer can answer", async () => {
  const { conversation: c, message } = conversation("Can you match a competitor's price?");
  const reason = declineOf(
    await generateAutoReply(
      c,
      message,
      fakeLlm({ needs_human: true, escalation_reason: "Price matching is not offered." })
    )
  );
  assert.equal(reason, "Price matching is not offered.");
});

test("surfaces the validator's reason when a rejected draft is not rescued by the rules", async () => {
  // Nothing in "how much did this cost last month?" matches a rule, so the
  // only account of what happened is the validator's rejection.
  const { conversation: c, message } = conversation("how much did this cost last month?");
  const reason = declineOf(
    await generateAutoReply(
      c,
      message,
      fakeLlm({ cited_product_ids: [], reply: "It was $59.00 last month." })
    )
  );
  assert.match(reason, /\$59\.00/);
});

test("reports a model outage rather than leaving an unexplained gap", async () => {
  const { conversation: c, message } = conversation("what is your return window?");
  const reason = declineOf(
    await generateAutoReply(c, message, async () => {
      throw new Error("503 high demand");
    })
  );
  assert.match(reason, /unavailable/i);
});

test("says nothing at all when there is no model to explain", async () => {
  // Rules-only mode: no assistant ran, so there is no decision to report and
  // a note on every unanswerable message would just be noise.
  const { conversation: c, message } = conversation("Can you match a competitor's price?");
  assert.equal(await generateAutoReply(c, message, null), null);
});

test("gives the model the customer's own order, and nothing else", async () => {
  let seen = "";
  const spy: LlmClient = async (userTurn) => {
    seen = userTurn;
    return {
      intent: "order_status",
      needs_human: true,
      escalation_reason: "",
      cited_product_ids: [],
      cited_order_number: "",
      reply: "",
    };
  };

  // #10432 belongs to +15550001002.
  const owner = conversation("where is order #10432?", "+15550001002");
  await generateAutoReply(owner.conversation, owner.message, spy);
  assert.match(seen, /CP481920347US/, "the owner should see their own order");

  // The same number asked from a different customer's conversation.
  const other = conversation("where is order #10432?", "+15550009999");
  await generateAutoReply(other.conversation, other.message, spy);
  assert.doesNotMatch(seen, /CP481920347US/, "another customer must not see it");
  assert.match(seen, /<order>\s*none/);
});
