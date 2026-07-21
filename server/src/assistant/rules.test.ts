// The deterministic fallback. These are the original assistant tests: they
// still pass unchanged after the LLM was added, which is the point — the app
// keeps working with no API key.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboundMessage } from "../../../shared/types.js";
import { rulesReply } from "./rules.js";

function message(text: string, customerName = "Emma Clark"): InboundMessage {
  return {
    id: `t-${Math.random()}`,
    from: "+15550001001",
    customerName,
    text,
    timestamp: new Date().toISOString(),
  };
}

test("greets a message that is only a greeting", () => {
  assert.match(rulesReply(message("Hello!"))?.text ?? "", /^Hi Emma!/);
});

test("echoes an order number that belongs to this customer", () => {
  const from = "+15550001002"; // owner of #10432
  const reply = rulesReply({ ...message("where is my order #10432?"), from });
  assert.match(reply?.text ?? "", /#10432/);
  assert.equal(reply?.orderNumber, "10432");
});

test("does not echo an order number it could not find", () => {
  // "I've pulled up order #99999" claims we found an order that doesn't exist.
  const reply = rulesReply(message("what's the status of order #99999?"));
  assert.doesNotMatch(reply?.text ?? "", /99999/);
  assert.match(reply?.text ?? "", /an agent will look into your order/);
});

test("does not echo another customer's order number", () => {
  // #10432 belongs to +15550001002, not to this conversation.
  const reply = rulesReply(message("what's the status of order #10432?"));
  assert.doesNotMatch(reply?.text ?? "", /10432/);
});

test("answers a product question from the catalog with price and stock", () => {
  const reply = rulesReply(message("do you have a desk lamp?"));
  assert.equal(reply?.text, "The Desk Lamp is $45.00 and in stock.");
  assert.deepEqual(reply?.productIds, ["p-004"]);
});

test("reports an out-of-stock product", () => {
  assert.equal(
    rulesReply(message("is the backpack available?"))?.text,
    "Sorry, the Backpack is currently out of stock."
  );
});

test("prefers the product answer when a greeting and a product question are combined", () => {
  // Customers usually lead with "Hi" and then ask the real question; the
  // specific answer is more useful than a greeting.
  assert.equal(
    rulesReply(message("Hi! Do you have the wireless headphones in stock?"))?.text,
    "The Wireless Headphones is $129.00 and in stock."
  );
});

test("does not mistake a product reference like '#2' for an order number", () => {
  assert.equal(
    rulesReply(message("is the desk lamp #2 available?"))?.text,
    "The Desk Lamp is $45.00 and in stock."
  );
});

test("leaves anything else for a human", () => {
  assert.equal(rulesReply(message("What is your favourite colour?")), null);
});

test("matches a product by alias, which the full-name-only matcher missed", () => {
  // "headphones" alone never matched "Wireless Headphones" before aliases.
  assert.equal(
    rulesReply(message("do you have headphones?"))?.text,
    "The Wireless Headphones is $129.00 and in stock."
  );
});

test("prefers the longer product term when two overlap", () => {
  // "travel mug" must not be read as "mug" (Coffee Mug).
  assert.deepEqual(rulesReply(message("is the travel mug leak proof?"))?.productIds, ["p-012"]);
});
