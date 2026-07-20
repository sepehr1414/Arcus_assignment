// Posts inbound messages to the webhook, standing in for a messaging provider.
// You shouldn't need to edit this.
//
//   npm run seed                                 send all of data/seed-messages.json
//   npm run simulate -- --text "hello"           send one message
//   npm run simulate -- --id dup-1 --text hi     (run twice to test duplicates)
//
// Flags: --seed  --text  --from  --name  --id  --url
import { readFileSync } from "node:fs";
import type { InboundMessage } from "../shared/types.js";

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const url = getFlag("url") ?? "http://localhost:4000/api/webhook";

async function post(message: InboundMessage): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    const bodyText = await res.text();
    console.log(
      `-> [${res.status}] ${message.id} (${message.customerName}): ${message.text}` +
        (bodyText ? `\n   ${bodyText}` : "")
    );
  } catch (err) {
    console.error(
      `x Could not reach ${url}. Is the app running (npm run dev)?`,
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (hasFlag("seed")) {
    const seed = JSON.parse(
      readFileSync("data/seed-messages.json", "utf-8")
    ) as InboundMessage[];
    console.log(`Seeding ${seed.length} messages -> ${url}\n`);
    for (const message of seed) {
      await post(message);
    }
    return;
  }

  const message: InboundMessage = {
    id: getFlag("id") ?? `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    from: getFlag("from") ?? "+15550009999",
    customerName: getFlag("name") ?? "Test Customer",
    text: getFlag("text") ?? "Hi, do you have this item in stock?",
    timestamp: new Date().toISOString(),
  };

  await post(message);
}

void main();
