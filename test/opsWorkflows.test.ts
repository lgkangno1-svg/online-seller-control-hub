import assert from "node:assert/strict";
import test from "node:test";
import { buildShippingPlan } from "../src/orders/shippingPlan.js";
import { normalizeClaimInbox, summarizeClaimInbox } from "../src/claims/claimInbox.js";
import { summarizeSettlements } from "../src/reporting/settlementSummary.js";

test("builds bounded shipment plan requiring approval", () => {
  const plan = buildShippingPlan([{ market: "naver", externalOrderLineId: "o1", carrierCode: "CJ", trackingNumber: "1234-5678" }]);
  assert.equal(plan.requiresApproval, true); assert.equal(plan.count, 1);
});

test("rejects duplicate shipment order lines", () => {
  const row = { market: "coupang", externalOrderLineId: "o1", carrierCode: "CJ", trackingNumber: "12345678" };
  assert.throws(() => buildShippingPlan([row, row]), /duplicate order line/);
});

test("normalizes and summarizes claims", () => {
  const claims = [{ market: "naver", externalClaimId: "c1", externalOrderLineId: "o1", type: "return", status: "requested", requestedAt: "2026-09-16T10:00:00+09:00" }];
  assert.equal(normalizeClaimInbox(claims)[0]?.externalClaimId, "c1");
  assert.deepEqual(summarizeClaimInbox(claims), { total: 1, actionable: 1, byType: { cancel: 0, return: 1, exchange: 0 } });
});

test("summarizes marketplace settlements", () => {
  const summary = summarizeSettlements([{ market: "naver", settlementId: "s1", periodStart: "2026-09-01", periodEnd: "2026-09-15", salesAmount: 100000, fees: 5000, refunds: 10000, payoutAmount: 85000 }]);
  assert.equal(summary.payoutAmount, 85000); assert.equal(summary.byMarket.naver, 85000); assert.equal(summary.fees, 5000);
});
