// The anti-hallucination gate.
//
// Each test hands the validator a draft a model plausibly *could* produce and
// asserts the fabricated ones are rejected. These are the tests that back the
// claim "the assistant cannot state a fact that isn't in the data" — the prompt
// asks for that, this enforces it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Order } from "../../../shared/types.js";
import { orders } from "./data.js";
import type { AssistantDraft } from "./gemini.js";
import { validate } from "./grounding.js";

const ORDER = orders.find((o) => o.orderNumber === "10432") as Order;

function draft(over: Partial<AssistantDraft> = {}): AssistantDraft {
  return {
    intent: "product_question",
    needs_human: false,
    escalation_reason: "",
    cited_product_ids: [],
    cited_order_number: "",
    reply: "",
    ...over,
  };
}

function reasonFor(d: AssistantDraft, order: Order | null = null): string {
  const result = validate(d, { order });
  assert.equal(result.ok, false, `expected rejection, got: ${JSON.stringify(result)}`);
  return result.ok ? "" : result.reason;
}

/* --- Replies that must pass ---------------------------------------------- */

test("accepts a correct product answer and reports its citations", () => {
  const result = validate(
    draft({
      cited_product_ids: ["p-001"],
      reply: "Yes, the Wireless Headphones are $129.00 and in stock.",
    }),
    { order: null }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.productIds, ["p-001"]);
});

test("accepts an out-of-stock answer for a product that is out of stock", () => {
  const result = validate(
    draft({ cited_product_ids: ["p-003"], reply: "Sorry, the Backpack is out of stock right now." }),
    { order: null }
  );
  assert.equal(result.ok, true);
});

test("accepts a grounded order answer", () => {
  const result = validate(
    draft({
      intent: "order_status",
      cited_order_number: "10432",
      reply: "Order #10432 is in transit with Cascade Post, estimated to arrive on 2026-07-22.",
    }),
    { order: ORDER }
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.orderNumber, "10432");
});

test("accepts the return window stated in natural words", () => {
  // policies.json stores `windowDays: 30`; the reply says "30 days". Found
  // live: this correct reply was being discarded before numeric duration
  // fields were rendered into checkable phrases.
  const result = validate(
    draft({ intent: "policy_question", reply: "You have 30 days to return an unused item." }),
    { order: null }
  );
  assert.equal(result.ok, true);
});

test("still rejects a wrong return window", () => {
  const reason = reasonFor(
    draft({ intent: "policy_question", reply: "You have 60 days to return an unused item." })
  );
  assert.match(reason, /60 days/);
});

test("accepts a shipping answer quoting a real policy amount", () => {
  const result = validate(
    draft({ intent: "policy_question", reply: "Standard shipping is $4.95 and takes 3 to 5 business days." }),
    { order: null }
  );
  assert.equal(result.ok, true);
});

/* --- Fabrications that must be rejected ----------------------------------- */

test("rejects a wrong price for a real product", () => {
  const reason = reasonFor(
    draft({ cited_product_ids: ["p-001"], reply: "The Wireless Headphones are $119.00 and in stock." })
  );
  assert.match(reason, /\$119\.00/);
});

test("rejects an invented product", () => {
  const reason = reasonFor(draft({ reply: "Our Drone is $299.00 and ships today." }));
  assert.match(reason, /matches no cited record|no cited product/);
});

test("rejects a product id that is not in the catalog", () => {
  const reason = reasonFor(draft({ cited_product_ids: ["p-999"], reply: "That one is available." }));
  assert.match(reason, /unknown product id/);
});

test("rejects a product mentioned but not cited", () => {
  // The dangerous case: everything said is true of p-001, but the drive-by
  // recommendation of the Power Bank was never checked against anything.
  const reason = reasonFor(
    draft({
      cited_product_ids: ["p-001"],
      reply: "The Wireless Headphones are $129.00. You might also like the Power Bank.",
    })
  );
  assert.match(reason, /Power Bank.*without citing/);
});

test("rejects an inverted stock claim", () => {
  const reason = reasonFor(
    draft({ cited_product_ids: ["p-003"], reply: "The Backpack is in stock and ready to ship." })
  );
  assert.match(reason, /claims in stock/);
});

test("rejects a claim that an in-stock product is sold out", () => {
  const reason = reasonFor(
    draft({ cited_product_ids: ["p-001"], reply: "The Wireless Headphones are sold out." })
  );
  assert.match(reason, /claims out of stock/);
});

test("rejects a fabricated restock date", () => {
  // The catalog has no restock field at all, so any date here is invented.
  const reason = reasonFor(
    draft({ cited_product_ids: ["p-003"], reply: "The Backpack should be back in stock on 2026-08-01." })
  );
  assert.match(reason, /restock date|not in the provided data|not in the catalog/);
});

test("rejects an order number that was not supplied", () => {
  const reason = reasonFor(
    draft({ intent: "order_status", reply: "Order #99999 shipped yesterday." }),
    ORDER
  );
  assert.match(reason, /#99999/);
});

test("rejects a shipment claim when no order is in context", () => {
  const reason = reasonFor(
    draft({ intent: "order_status", reply: "Your parcel was dispatched and is with the carrier." })
  );
  assert.match(reason, /no order in context/);
});

test("rejects a delivery date that is not on the order record", () => {
  const reason = reasonFor(
    draft({
      intent: "order_status",
      cited_order_number: "10432",
      reply: "Order #10432 will arrive on 2026-07-30.",
    }),
    ORDER
  );
  assert.match(reason, /2026-07-30/);
});

test("rejects an invented delivery window", () => {
  const reason = reasonFor(
    draft({ intent: "policy_question", reply: "Standard shipping takes 1 to 2 days." })
  );
  assert.match(reason, /1 to 2 days/);
});

test("rejects markdown formatting", () => {
  const reason = reasonFor(
    draft({ cited_product_ids: ["p-001"], reply: "The **Wireless Headphones** are $129.00." })
  );
  assert.match(reason, /markdown/);
});

test("rejects a link", () => {
  const reason = reasonFor(
    draft({ cited_product_ids: ["p-001"], reply: "See https://example.com/headphones for details." })
  );
  assert.match(reason, /link or email/);
});

test("rejects an escalation, so nothing is stored", () => {
  const reason = reasonFor(
    draft({ needs_human: true, escalation_reason: "Restock date is not in the catalog." })
  );
  assert.match(reason, /model escalated/);
});

test("rejects an empty reply that did not escalate", () => {
  assert.match(reasonFor(draft({ reply: "   " })), /empty reply/);
});

test("rejects a reply that runs on well past a support answer", () => {
  const reason = reasonFor(
    draft({
      cited_product_ids: ["p-001"],
      reply: "One. Two. Three. Four. Five. Six.",
    })
  );
  assert.match(reason, /too many sentences/);
});
