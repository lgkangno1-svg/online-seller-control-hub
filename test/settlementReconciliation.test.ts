import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSettlements } from "../src/settlement/settlementReconciliation.js";

test("matches aggregated settlement rows within tolerance", () => {
  const report = reconcileSettlements({
    expected: [
      { market: "naver", orderId: "o-1", expectedNetAmount: 9000, expectedMarketplaceFee: 1000 }
    ],
    actual: [
      { market: "naver", settlementId: "s-1", orderId: "o-1", netAmount: 4000, marketplaceFee: 400, settledAt: "2026-09-17T01:00:00+00:00" },
      { market: "naver", settlementId: "s-2", orderId: "o-1", netAmount: 5000.5, marketplaceFee: 600, settledAt: "2026-09-17T02:00:00+00:00" }
    ],
    tolerance: 1
  });

  assert.equal(report.rows[0]?.status, "matched");
  assert.equal(report.rows[0]?.actualNetAmount, 9000.5);
  assert.deepEqual(report.rows[0]?.settlementIds, ["s-1", "s-2"]);
  assert.deepEqual(report.summary, {
    totalOrders: 1,
    matched: 1,
    missing: 0,
    mismatch: 0,
    unexpected: 0,
    absoluteNetDifference: 0.5
  });
});

test("surfaces missing, mismatched and unexpected settlements", () => {
  const report = reconcileSettlements({
    expected: [
      { market: "coupang", orderId: "o-1", expectedNetAmount: 8000, expectedMarketplaceFee: 1000 },
      { market: "coupang", orderId: "o-2", expectedNetAmount: 5000, expectedMarketplaceFee: 500 }
    ],
    actual: [
      { market: "coupang", settlementId: "s-1", orderId: "o-1", netAmount: 7000, marketplaceFee: 1200, settledAt: "2026-09-17T01:00:00+00:00" },
      { market: "coupang", settlementId: "s-3", orderId: "o-3", netAmount: 2000, marketplaceFee: 100, settledAt: "2026-09-17T03:00:00+00:00" }
    ]
  });

  assert.deepEqual(report.rows.map((row) => [row.orderId, row.status]), [
    ["o-1", "mismatch"],
    ["o-2", "missing"],
    ["o-3", "unexpected"]
  ]);
  assert.equal(report.summary.mismatch, 1);
  assert.equal(report.summary.missing, 1);
  assert.equal(report.summary.unexpected, 1);
  assert.equal(report.summary.absoluteNetDifference, 8000);
});

test("rejects duplicate expected orders and duplicate settlement ids", () => {
  assert.throws(() => reconcileSettlements({
    expected: [
      { market: "toss", orderId: "same", expectedNetAmount: 1 },
      { market: "toss", orderId: "same", expectedNetAmount: 1 }
    ],
    actual: []
  }), /duplicate expected marketplace order/);

  assert.throws(() => reconcileSettlements({
    expected: [],
    actual: [
      { market: "gmarket", settlementId: "dup", orderId: "o-1", netAmount: 1, settledAt: "2026-09-17T01:00:00+00:00" },
      { market: "gmarket", settlementId: "dup", orderId: "o-2", netAmount: 1, settledAt: "2026-09-17T02:00:00+00:00" }
    ]
  }), /duplicate marketplace settlement/);
});
