import assert from "node:assert/strict";
import test from "node:test";
import { planStockSyncBatch } from "../src/operations/stockSyncBatch.js";

test("plans changed stock and marks risky writes for confirmation", () => {
  const actions = planStockSyncBatch([
    { marketplace: "naver", sku: "SKU-1", currentStock: 5, targetStock: 5 },
    { marketplace: "coupang", sku: "SKU-1", currentStock: 12, targetStock: 0 },
    { marketplace: "naver", sku: "SKU-2", currentStock: 2, targetStock: 4 },
  ]);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.requiresConfirmation, true);
  assert.equal(actions[1]?.requiresConfirmation, false);
});

test("rejects duplicate marketplace sku targets", () => {
  assert.throws(() => planStockSyncBatch([
    { marketplace: "naver", sku: "A", currentStock: 1, targetStock: 2 },
    { marketplace: "naver", sku: "A", currentStock: 2, targetStock: 3 },
  ]));
});
