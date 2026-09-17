import assert from "node:assert/strict";
import test from "node:test";
import { buildPriceStockSyncPlan } from "../src/catalog/priceStockSync.js";

test("plans only changed price and stock values", () => {
  const plan = buildPriceStockSyncPlan([
    { masterSku: "A", market: "naver", externalId: "N1", currentPrice: 10000, currentStock: 5, targetPrice: 11000, targetStock: 5 },
    { masterSku: "B", market: "coupang", externalId: "C1", currentPrice: 20000, currentStock: 0, targetStock: 7 },
    { masterSku: "C", market: "gmarket", externalId: "G1", currentPrice: 30000, currentStock: 3, targetPrice: 30000 }
  ]);
  assert.equal(plan.totalActions, 2);
  assert.equal(plan.priceChanges, 1);
  assert.equal(plan.stockChanges, 1);
  assert.deepEqual(plan.markets, ["naver", "coupang"]);
  assert.equal(plan.requiresConfirmation, true);
});

test("returns no writes when targets already match", () => {
  const plan = buildPriceStockSyncPlan([{ masterSku: "A", market: "naver", externalId: "N1", currentPrice: 10000, currentStock: 5, targetPrice: 10000, targetStock: 5 }]);
  assert.equal(plan.totalActions, 0);
  assert.equal(plan.requiresConfirmation, false);
});

test("rejects duplicate marketplace products and unsafe prices", () => {
  assert.throws(() => buildPriceStockSyncPlan([
    { masterSku: "A", market: "naver", externalId: "N1", currentPrice: 10000, currentStock: 1, targetStock: 2 },
    { masterSku: "B", market: "naver", externalId: "N1", currentPrice: 20000, currentStock: 2, targetStock: 3 }
  ]));
  assert.throws(() => buildPriceStockSyncPlan([{ masterSku: "A", market: "naver", externalId: "N1", currentPrice: 10000, currentStock: 1, targetPrice: 50 }]));
});
