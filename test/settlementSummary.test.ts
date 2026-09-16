import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSettlement, summarizeSettlements } from "../src/settlement/settlementSummary.js";

test("normalizes expected and settled marketplace proceeds", () => {
  const expected = normalizeSettlement({
    market: "naver",
    orderId: "N-1",
    grossAmount: 10000,
    marketplaceFee: 1000,
    shippingFee: 3000
  });
  assert.equal(expected.netAmount, 12000);
  assert.equal(expected.status, "expected");

  const settled = normalizeSettlement({
    market: "coupang",
    orderId: "C-1",
    grossAmount: 20000,
    marketplaceFee: 2000,
    adjustmentAmount: -500,
    settledAt: "2026-09-16T00:00:00Z"
  });
  assert.equal(settled.netAmount, 17500);
  assert.equal(settled.status, "settled");
});

test("summarizes settlement totals across marketplaces", () => {
  const summary = summarizeSettlements([
    { market: "naver", orderId: "N-1", grossAmount: 10000, marketplaceFee: 1000 },
    { market: "naver", orderId: "N-2", grossAmount: 5000, marketplaceFee: 500, settledAt: "2026-09-16" },
    { market: "coupang", orderId: "C-1", grossAmount: 20000, marketplaceFee: 2000, shippingFee: 3000 }
  ]);

  assert.equal(summary.orders, 3);
  assert.equal(summary.grossAmount, 35000);
  assert.equal(summary.marketplaceFee, 3500);
  assert.equal(summary.netAmount, 34500);
  assert.equal(summary.settledAmount, 4500);
  assert.equal(summary.expectedAmount, 30000);
  assert.deepEqual(summary.byMarket.naver, { orders: 2, netAmount: 13500 });
  assert.deepEqual(summary.byMarket.coupang, { orders: 1, netAmount: 21000 });
});

test("rejects malformed settlement records", () => {
  assert.throws(() => normalizeSettlement({ market: "naver", orderId: "", grossAmount: 1000 }));
  assert.throws(() => normalizeSettlement({ market: "naver", orderId: "N-1", grossAmount: -1 }));
});
