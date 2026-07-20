import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InboundMessage, Product } from "../../shared/types.js";

// Load the product catalog once at startup.
const catalog = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../data/catalog.json"),
    "utf-8"
  )
) as Product[];

// Decides whether to auto-reply, and what to say. No real AI — a few simple,
// deterministic rules. Returns the reply text, or null to leave it for a human.
// Rules are checked in order; the first match wins.
export function assistantReply(message: InboundMessage): string | null {
  const text = message.text.toLowerCase();
  const firstName = message.customerName.split(" ")[0] || "there";

  // Specific intents are checked before the generic greeting, because customers
  // often lead with "Hi, ..." and then ask the real question in the same message.

  // 1) Order status. Requires the word "order" — a bare "#2" in a product
  // question ("is the desk lamp #2 available?") must not land here.
  if (/\border\b/i.test(message.text)) {
    const orderNumber = message.text.match(/order\s*#?\s*(\d+)/i)?.[1];
    return orderNumber
      ? `Thanks — I've pulled up order #${orderNumber} and an agent will follow up with a status shortly.`
      : `Thanks — an agent will look into your order and follow up shortly.`;
  }

  // 2) Product / stock question answered from the catalog.
  const product = catalog.find((p) => text.includes(p.name.toLowerCase()));
  if (product) {
    return product.inStock
      ? `The ${product.name} is $${product.price.toFixed(2)} and in stock.`
      : `Sorry, the ${product.name} is currently out of stock.`;
  }

  // 3) Greeting / thanks (fallback for messages that are only a greeting).
  if (/\b(hi|hello|hey|thanks|thank you)\b/i.test(message.text)) {
    return `Hi ${firstName}! Thanks for reaching out — how can we help today?`;
  }

  // Otherwise, leave it for a human.
  return null;
}
