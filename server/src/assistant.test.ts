// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboundMessage } from "../../shared/types.js";
import { assistantReply } from "./assistant.js";

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
  const reply = assistantReply(message("Hello!"));
  assert.match(reply ?? "", /^Hi Emma!/);
});

test("answers an order question and echoes the order number", () => {
  const reply = assistantReply(message("where is my order #10432?"));
  assert.match(reply ?? "", /#10432/);
});

test("answers a product question from the catalog with price and stock", () => {
  const reply = assistantReply(message("do you have a desk lamp?"));
  assert.equal(reply, "The Desk Lamp is $45.00 and in stock.");
});

test("reports an out-of-stock product", () => {
  const reply = assistantReply(message("is the backpack available?"));
  assert.equal(reply, "Sorry, the Backpack is currently out of stock.");
});

test("prefers the product answer when a greeting and a product question are combined", () => {
  // Customers usually lead with "Hi" and then ask the real question; the
  // specific answer is more useful than a greeting.
  const reply = assistantReply(message("Hi! Do you have the wireless headphones in stock?"));
  assert.equal(reply, "The Wireless Headphones is $129.00 and in stock.");
});

test("does not mistake a product reference like '#2' for an order number", () => {
  const reply = assistantReply(message("is the desk lamp #2 available?"));
  assert.equal(reply, "The Desk Lamp is $45.00 and in stock.");
});

test("leaves anything else for a human", () => {
  assert.equal(assistantReply(message("And what colors does it come in?")), null);
});
