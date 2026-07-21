// Loads the assistant's grounding corpus once at startup and provides the
// deterministic lookups that run *before* the model does.
//
// Everything the assistant is allowed to know lives in these three files. The
// model never fetches anything; we hand it the facts and then check its answer
// against the same facts.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Order, Policies, Product } from "../../../shared/types.js";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8")) as T;
}

export const catalog: Product[] = loadJson<Product[]>("catalog.json");
export const policies: Policies = loadJson<Policies>("policies.json");
export const orders: Order[] = loadJson<Order[]>("orders.json");

const byId = new Map(catalog.map((p) => [p.id, p]));

export function productById(id: string): Product | undefined {
  return byId.get(id);
}

/**
 * Every way a product can be referred to (its name plus its aliases), longest
 * first. Longest-first matters: "travel mug" must win over "mug", and "notebook
 * stand" over "notebook", otherwise a longer phrase gets attributed to the
 * wrong product.
 */
const PRODUCT_TERMS: { term: string; product: Product }[] = catalog
  .flatMap((product) =>
    [product.name, ...product.aliases].map((term) => ({
      term: term.toLowerCase(),
      product,
    }))
  )
  .sort((a, b) => b.term.length - a.term.length);

/** Does `term` appear in `haystack` on word boundaries? */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i").test(haystack);
}

/**
 * Products referred to anywhere in `text`, by name or alias.
 *
 * Once a term matches, the span it covers is blanked out before trying shorter
 * terms, so "travel mug" is not also reported as "mug" (Coffee Mug). This is
 * used to find what a customer asked about, and — more importantly — to catch a
 * generated reply that name-drops a product it did not cite.
 */
export function findProductsInText(text: string): Product[] {
  let remaining = text.toLowerCase();
  const found: Product[] = [];

  for (const { term, product } of PRODUCT_TERMS) {
    if (found.includes(product)) continue;
    if (!containsTerm(remaining, term)) continue;
    found.push(product);
    // Blank the matched spans so a shorter term can't re-match inside them.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remaining = remaining.replace(
      new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "gi"),
      " ".repeat(term.length)
    );
  }

  return found;
}

/** The order numbers mentioned in a message, e.g. "order #10432" or "order 10432". */
export function orderNumbersInText(text: string): string[] {
  const matches = text.matchAll(/\b(?:order|#)\s*#?\s*(\d{4,})\b/gi);
  return [...new Set([...matches].map((m) => m[1]))];
}

/**
 * Find the one order this customer is asking about.
 *
 * Two deliberate restrictions: the number must be written in the message (we
 * never guess which order someone means), and the order must belong to this
 * conversation's phone number — so one customer's order can never end up in
 * another customer's prompt.
 */
export function findOrder(text: string, customerPhone: string): Order | null {
  const numbers = orderNumbersInText(text);
  if (numbers.length !== 1) return null; // none, or ambiguous — leave it to a human
  const order = orders.find((o) => o.orderNumber === numbers[0]);
  if (!order || order.customerPhone !== customerPhone) return null;
  return order;
}

/** Every fixed monetary amount a reply is allowed to quote from the policies. */
export function policyAmounts(): number[] {
  const amounts: number[] = [];
  for (const option of policies.shipping.options) {
    amounts.push(option.cost);
    if (option.freeOver !== null) amounts.push(option.freeOver);
  }
  return amounts;
}
