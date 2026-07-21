// Deterministic fallback rules.
//
// These ran the whole assistant before the LLM was added, and they are kept as
// the safety net underneath it: no API key, a network error, or a reply that
// fails the grounding check all fall through to here. That keeps the app
// working offline and keeps every path testable without a network call.
//
// Rules are checked in order; the first match wins. They only ever state facts
// read straight out of the catalog.

import type { InboundMessage, Product } from "../../../shared/types.js";
import { findOrder, findProductsInText } from "./data.js";

export interface RuleReply {
  text: string;
  productIds: string[];
  orderNumber?: string;
}

function stockLine(product: Product): string {
  return product.inStock
    ? `The ${product.name} is $${product.price.toFixed(2)} and in stock.`
    : `Sorry, the ${product.name} is currently out of stock.`;
}

export function rulesReply(message: InboundMessage): RuleReply | null {
  const firstName = message.customerName.split(" ")[0] || "there";

  // Specific intents are checked before the generic greeting, because customers
  // often lead with "Hi, ..." and then ask the real question in the same message.

  // 1) Order status. Requires the word "order" — a bare "#2" in a product
  // question ("is the desk lamp #2 available?") must not land here.
  //
  // The number is echoed back ONLY when it matches a real order on this
  // customer's account. Repeating an unknown number as "I've pulled up order
  // #99999" tells the customer we found something we did not — a small lie, but
  // the same kind as a wrong price, so the rules are held to the same standard
  // as the model. (Found by the red-team script; see the README.)
  if (/\border\b/i.test(message.text)) {
    const order = findOrder(message.text, message.from);
    return order
      ? {
          text: `Thanks — I've pulled up order #${order.orderNumber} and an agent will follow up with a status shortly.`,
          productIds: [],
          orderNumber: order.orderNumber,
        }
      : {
          text: `Thanks — an agent will look into your order and follow up shortly.`,
          productIds: [],
        };
  }

  // 2) Product / stock question answered from the catalog.
  const [product] = findProductsInText(message.text);
  if (product) {
    return { text: stockLine(product), productIds: [product.id] };
  }

  // 3) Greeting / thanks (fallback for messages that are only a greeting).
  if (/\b(hi|hello|hey|thanks|thank you)\b/i.test(message.text)) {
    return {
      text: `Hi ${firstName}! Thanks for reaching out — how can we help today?`,
      productIds: [],
    };
  }

  // Otherwise, leave it for a human.
  return null;
}
