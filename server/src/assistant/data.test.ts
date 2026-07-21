// Integrity of the grounding corpus.
//
// The validator trusts these files completely, so a broken one is a silent
// correctness bug rather than a crash: an alias that matches two products would
// attribute a claim to the wrong record.
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, findOrder, findProductsInText, orders, productById } from "./data.js";

test("product ids and skus are unique", () => {
  assert.equal(new Set(catalog.map((p) => p.id)).size, catalog.length);
  assert.equal(new Set(catalog.map((p) => p.sku)).size, catalog.length);
});

test("no search term is claimed by two different products", () => {
  // A term shared by two products would silently attribute a claim to the wrong
  // record — the one data error the validator cannot catch. (A product
  // repeating its own name in `aliases` is just redundancy, not a collision.)
  const owner = new Map<string, string>();
  for (const product of catalog) {
    for (const term of new Set([product.name, ...product.aliases].map((t) => t.toLowerCase()))) {
      const existing = owner.get(term);
      assert.ok(
        existing === undefined || existing === product.id,
        `"${term}" is claimed by both ${existing} and ${product.id}`
      );
      owner.set(term, product.id);
    }
  }
});

test("every alias actually resolves to its own product", () => {
  for (const product of catalog) {
    for (const alias of product.aliases) {
      const [found] = findProductsInText(`do you have the ${alias}?`);
      assert.equal(found?.id, product.id, `alias "${alias}" resolved to ${found?.name}`);
    }
  }
});

test("relatedIds all resolve to real products", () => {
  for (const product of catalog) {
    for (const id of product.relatedIds) {
      assert.ok(productById(id), `${product.name} points at missing product ${id}`);
    }
  }
});

test("out-of-stock products have no stock on hand", () => {
  for (const product of catalog) {
    assert.equal(product.inStock, product.stockCount > 0, `${product.name} disagrees with itself`);
  }
});

test("order line items reference real products and add up to the total", () => {
  for (const order of orders) {
    for (const item of order.items) {
      const product = productById(item.productId);
      assert.ok(product, `order ${order.orderNumber} references missing ${item.productId}`);
      assert.equal(item.name, product?.name);
    }
    const sum = order.items.reduce((n, i) => n + i.unitPrice * i.quantity, 0);
    assert.equal(Math.round(sum * 100), Math.round(order.total * 100));
  }
});

test("an order is only found for the customer it belongs to", () => {
  assert.equal(findOrder("where is order #10432?", "+15550001002")?.orderNumber, "10432");
  assert.equal(findOrder("where is order #10432?", "+15550009999"), null);
});

test("an order is never guessed when no number is given", () => {
  assert.equal(findOrder("where is my order?", "+15550001002"), null);
});

test("an ambiguous message naming two orders is left for a human", () => {
  assert.equal(findOrder("orders #10432 and #10433?", "+15550001002"), null);
});
