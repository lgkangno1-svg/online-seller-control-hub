import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogBulkPatchPlan } from "../src/catalog/catalogBulkPatch.js";

test("builds a bounded multi-product edit plan without executing writes", () => {
  const plan = buildCatalogBulkPatchPlan([
    { masterSku: "SKU-1", name: "New name", aliases: ["alias"], mappings: [{ market: "naver", productId: "N-1" }] },
    { masterSku: "SKU-2", mappings: [{ market: "coupang", externalId: "C-2" }, { market: "gmarket", productId: null }] }
  ]);
  assert.equal(plan.totalProducts, 2);
  assert.equal(plan.totalFieldChanges, 5);
  assert.equal(plan.mappingChanges, 3);
  assert.deepEqual(plan.markets, ["naver", "coupang", "gmarket"]);
  assert.equal(plan.requiresConfirmation, true);
});

test("rejects duplicate SKUs and empty patches", () => {
  assert.throws(() => buildCatalogBulkPatchPlan([{ masterSku: "A" }]));
  assert.throws(() => buildCatalogBulkPatchPlan([{ masterSku: "A", name: "one" }, { masterSku: " a ", aliases: ["two"] }]));
});

test("rejects duplicate marketplace mapping patches", () => {
  assert.throws(() => buildCatalogBulkPatchPlan([{ masterSku: "A", mappings: [{ market: "naver", productId: "1" }, { market: "naver", externalId: "2" }] }]));
});
