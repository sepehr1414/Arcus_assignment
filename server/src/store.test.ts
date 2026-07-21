// Internal notes must not behave like answers.
//
// A note is stored in the thread right after the customer's message, so every
// derived signal in the inbox list has to skip it. Getting this wrong is silent
// and expensive: the amber "needs reply" flag would clear itself and the
// customer would drop off the agent's radar entirely.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the store at a scratch file before importing it, so these tests never
// touch data/inbox.json.
process.env.INBOX_FILE = join(mkdtempSync(join(tmpdir(), "inbox-test-")), "inbox.json");

const { addNote, addReply, getConversation, listConversations, saveInbound } = await import(
  "./store.js"
);

let seq = 0;
function inbound(text: string, phone: string) {
  seq++;
  return {
    id: `store-test-${phone}-${seq}`,
    from: phone,
    customerName: "Note Tester",
    // In the past: messages are ordered by timestamp, so a fixture stamped in
    // the future would sort *after* a reply added at wall-clock "now".
    timestamp: new Date(Date.now() - 60_000 + seq * 1000).toISOString(),
    text,
  };
}

function summaryFor(phone: string) {
  const found = listConversations().find((c) => c.id === phone);
  assert.ok(found, `no conversation for ${phone}`);
  return found;
}

test("a note does not count as answering the customer", () => {
  const phone = "+15550008001";
  saveInbound(inbound("When will the backpack be restocked?", phone));
  addNote(phone, "Restock date is not a field in the catalog.");

  const summary = summaryFor(phone);
  assert.equal(summary.awaitingReply, true, "the customer is still waiting");
  assert.equal(summary.preview, "When will the backpack be restocked?");
  assert.equal(summary.messageCount, 1, "the note is not a conversation message");
});

test("a real reply after a note does clear the waiting flag", () => {
  const phone = "+15550008002";
  saveInbound(inbound("Do you ship to Canada?", phone));
  addNote(phone, "Assistant unavailable (the model call failed).");
  addReply(phone, "Yes, we ship to Canada.", "agent");

  const summary = summaryFor(phone);
  assert.equal(summary.awaitingReply, false);
  assert.equal(summary.preview, "Yes, we ship to Canada.");
  assert.equal(summary.messageCount, 2);
});

test("the note is still on the thread, where the agent reads it", () => {
  const phone = "+15550008003";
  saveInbound(inbound("Give me 20% off.", phone));
  addNote(phone, "Support agents cannot create or apply discounts.");

  // Hidden from the list summary, but present in the thread itself.
  const thread = getConversation(phone);
  const note = thread?.messages.find((m) => m.sender === "system");
  assert.equal(note?.text, "Support agents cannot create or apply discounts.");
  assert.equal(summaryFor(phone).messageCount, 1);
});

test("notes are searchable, so an agent can find why the assistant went quiet", () => {
  const phone = "+15550008004";
  saveInbound(inbound("Is the grinder cheaper than last month?", phone));
  addNote(phone, "We do not have historical pricing data.");

  const hits = listConversations("historical pricing");
  assert.ok(
    hits.some((c) => c.id === phone),
    "searching a note's text should still find the conversation"
  );
});
