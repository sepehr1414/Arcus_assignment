// The grounding gate.
//
// A prompt is a request, not a guarantee. This module is the guarantee: every
// draft is re-read against the same catalog the model was given, and anything
// that cannot be traced back to a record is discarded before it can be stored.
//
// Failing closed is the whole point. When a check cannot be satisfied we reject,
// which sometimes throws away a *correct* reply — the cost of that is an
// escalation to a human who was going to read the thread anyway, which is much
// cheaper than one confident wrong price.
//
// Checks 3, 4, 5, 7 and 9 are exact (identifier, number and string equality).
// Checks 6 and 8 are heuristics over natural language and are documented as such.

import type { Order, Product } from "../../../shared/types.js";
import type { AssistantDraft } from "./gemini.js";
import { findProductsInText, policies, policyAmounts, productById } from "./data.js";

export interface GroundingContext {
  order: Order | null;
}

export type GroundingResult =
  | { ok: true; text: string; productIds: string[]; orderNumber?: string }
  // `escalated` marks the model's own deliberate hand-off to a human, as
  // opposed to a draft we rejected. Callers must not answer past it.
  | { ok: false; reason: string; escalated?: true };

const MAX_REPLY_CHARS = 500;
const MAX_SENTENCES = 4;

function reject(reason: string): GroundingResult {
  return { ok: false, reason };
}

/** Prices anywhere in the reply, as cent-integers to dodge float comparison. */
function quotedAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) =>
    Math.round(Number(m[1]) * 100)
  );
}

const IN_STOCK_CLAIM = /\b(in stock|available now|we have (?:it|these|those) in|ready to ship)\b/i;
const OUT_OF_STOCK_CLAIM = /\b(out of stock|sold out|unavailable|not in stock|back in stock)\b/i;

export function validate(draft: AssistantDraft, ctx: GroundingContext): GroundingResult {
  // 1) The model asked for a human, or produced nothing.
  if (draft.needs_human) {
    return {
      ok: false,
      reason: `model escalated: ${draft.escalation_reason || "no reason given"}`,
      escalated: true,
    };
  }
  const text = draft.reply.trim();
  if (!text) return reject("empty reply");

  // 2) Shape — length, sentence count, and no formatting we never asked for.
  if (text.length > MAX_REPLY_CHARS) return reject("reply too long");
  const sentences = text.split(/[.!?]+\s/).filter(Boolean).length;
  if (sentences > MAX_SENTENCES) return reject("reply has too many sentences");
  // Note "#" is not a banned character: "order #10432" is a legitimate
  // reference. Only a markdown *heading* (# at the start of a line) counts.
  if (/[*\[\]`_]|^\s*#{1,6}\s|^\s*[-•]\s/m.test(text)) {
    return reject("reply contains markdown");
  }
  if (/https?:\/\/|www\.|\S+@\S+\.\S+/i.test(text)) return reject("reply contains a link or email");

  // 3) Every cited id must be a real catalog entry.
  const cited: Product[] = [];
  for (const id of draft.cited_product_ids) {
    const product = productById(id);
    if (!product) return reject(`cited unknown product id "${id}"`);
    cited.push(product);
  }

  // 5) Uncited mentions. If the reply names a product it did not cite, we
  // cannot check the claims made about it — so we do not send it. This is what
  // catches a plausible drive-by recommendation.
  for (const mentioned of findProductsInText(text)) {
    if (!cited.includes(mentioned)) {
      return reject(`mentions "${mentioned.name}" without citing it`);
    }
  }

  // 4) Every price quoted must match a cited product or a fixed policy amount,
  // to the cent.
  const allowedAmounts = new Set<number>([
    ...cited.map((p) => Math.round(p.price * 100)),
    ...policyAmounts().map((a) => Math.round(a * 100)),
    ...(ctx.order?.items.map((i) => Math.round(i.unitPrice * 100)) ?? []),
    ...(ctx.order ? [Math.round(ctx.order.total * 100)] : []),
  ]);
  for (const amount of quotedAmounts(text)) {
    if (!allowedAmounts.has(amount)) {
      return reject(`quotes $${(amount / 100).toFixed(2)}, which matches no cited record`);
    }
  }

  // (The "amount with nothing to anchor it" guard is already covered above: with
  // no cited product and no order, the only amounts in `allowedAmounts` are the
  // fixed policy fees, so an invented product price cannot get through.)

  // 6) Stock claims must agree with the cited products (heuristic: we look at
  // the claim and the cited set, not at which clause attaches to which noun, so
  // a reply mixing an in-stock and an out-of-stock product is rejected rather
  // than parsed).
  if (IN_STOCK_CLAIM.test(text) && !OUT_OF_STOCK_CLAIM.test(text)) {
    if (cited.length === 0) return reject("stock claim with no cited product");
    if (cited.some((p) => !p.inStock)) {
      return reject("claims in stock for a product that is not in stock");
    }
  }
  if (OUT_OF_STOCK_CLAIM.test(text) && !IN_STOCK_CLAIM.test(text)) {
    if (cited.some((p) => p.inStock)) {
      return reject("claims out of stock for a product that is in stock");
    }
  }
  // Restock dates do not exist in the catalog, so any promise of one is invented.
  if (/\b(back in stock|restock\w*)\b/i.test(text) && /\b(on|by|in|within)\b/i.test(text)) {
    if (/\b(\d{1,2}\s+(day|week|month)|\d{4}-\d{2}-\d{2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text)) {
      return reject("states a restock date, which is not in the catalog");
    }
  }

  // 7) Order references must match the order actually supplied.
  const referenced = [...text.matchAll(/#\s?(\d{4,})/g)].map((m) => m[1]);
  const claimed = draft.cited_order_number.trim();
  if (claimed && claimed !== ctx.order?.orderNumber) {
    return reject(`cited order "${claimed}" was not the order supplied`);
  }
  for (const number of referenced) {
    if (number !== ctx.order?.orderNumber) {
      return reject(`reply references order #${number}, which was not supplied`);
    }
  }
  if (!ctx.order && /\b(tracking|carrier|dispatched|shipped on|arriv\w+ on)\b/i.test(text)) {
    return reject("makes a shipment claim with no order in context");
  }
  // A delivery date must be the one on the record.
  if (ctx.order) {
    for (const date of text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) {
      const known = [
        ctx.order.estimatedDelivery,
        ctx.order.deliveredAt?.slice(0, 10),
        ctx.order.placedAt.slice(0, 10),
        ctx.order.dispatchedAt?.slice(0, 10),
      ];
      if (!known.includes(date)) return reject(`states date ${date}, which is not on the order`);
    }
  }

  // 8) Durations. Any "N business days" style claim must appear verbatim
  // somewhere in the policies (heuristic: substring presence, not semantics).
  //
  // Numeric fields are rendered into the phrases a reply would naturally use:
  // `windowDays: 30` licenses "30 days" / "30-day". Without this, a correct
  // "you have 30 days to return it" was discarded because the raw JSON contains
  // `"windowDays":30`, not the words — a false positive found in live testing.
  const policyText = [
    JSON.stringify(policies),
    `${policies.returns.windowDays} days`,
    `${policies.returns.windowDays}-day`,
  ]
    .join(" ")
    .toLowerCase();
  for (const match of text.matchAll(/\b(\d+)\s*(?:to|-|–)\s*(\d+)\s+(business days|days|weeks|months)\b/gi)) {
    const phrase = `${match[1]} to ${match[2]} ${match[3]}`.toLowerCase();
    if (!policyText.includes(phrase)) return reject(`states "${phrase}", which is not in the policies`);
  }
  for (const match of text.matchAll(/\b(\d+)\s+(business days|day|days|weeks|months)\b/gi)) {
    const phrase = `${match[1]} ${match[2]}`.toLowerCase();
    // Skip ones already covered by a range above, and warranty periods we can verify.
    if (policyText.includes(phrase)) continue;
    if (cited.some((p) => `${p.warrantyMonths} months`.toLowerCase() === phrase)) continue;
    if (cited.some((p) => Object.values(p.specs).some((s) => s.toLowerCase().includes(phrase)))) continue;
    return reject(`states "${phrase}", which is not in the provided data`);
  }

  return {
    ok: true,
    text,
    productIds: cited.map((p) => p.id),
    ...(claimed ? { orderNumber: claimed } : {}),
  };
}
