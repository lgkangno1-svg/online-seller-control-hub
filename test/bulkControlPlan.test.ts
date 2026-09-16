import assert from "node:assert/strict";
import test from "node:test";
import { buildBulkControlPlan } from "../src/core/bulkControlPlan.js";

test("builds one reviewable plan across products and markets without executing writes", () => {
  const plan = buildBulkControlPlan([
    { masterSku: "SKU-1", action: "SET_STOCK", value: 12, markets: ["naver", "coupang"] },
    { masterSku: "SKU-2", action: "SET_PRICE", value: 19900, markets: ["naver", "gmarket"] }
  ]);
  assert.equal(plan.totalProducts, 2);
  assert.equal(plan.totalWrites, 4);
  assert.deepEqual(plan.markets, ["naver", "coupang", "gmarket"]);
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.rows[0]?.command.productQuery, "SKU-1");
});

test("deduplicates repeated markets so a SKU is not written twice to one marketplace", () => {
  const plan = buildBulkControlPlan([
    { masterSku: "SKU-1", action: "SET_STOCK", value: 3, markets: ["naver", "naver"] }
  ]);
  assert.equal(plan.totalWrites, 1);
  assert.deepEqual(plan.rows[0]?.command.markets, ["naver"]);
});

test("rejects duplicate SKU/action rows and unsafe prices", () => {
  assert.throws(() => buildBulkControlPlan([
    { masterSku: "SKU-1", action: "SET_STOCK", value: 3, markets: ["naver"] },
    { masterSku: " sku-1 ", action: "SET_STOCK", value: 4, markets: ["coupang"] }
  ]));
  assert.throws(() => buildBulkControlPlan([
    { masterSku: "SKU-2", action: "SET_PRICE", value: 10, markets: ["naver"] }
  ]));
});

test("bounds bulk plans to 500 products", () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ masterSku: `SKU-${index}`, action: "SET_STOCK", value: 1, markets: ["naver"] }));
  assert.throws(() => buildBulkControlPlan(rows));
});
