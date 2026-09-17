import assert from "node:assert/strict";
import test from "node:test";
import { auditSettlementFees } from "../src/settlement/feeAudit.js";

test("flags meaningful settlement fee differences", () => {
  const anomalies = auditSettlementFees([
    { marketplace: "naver", orderId: "A", grossAmount: 100000, expectedFee: 3000, actualFee: 3020 },
    { marketplace: "coupang", orderId: "B", grossAmount: 100000, expectedFee: 3000, actualFee: 3500 },
  ]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]?.orderId, "B");
  assert.equal(anomalies[0]?.delta, 500);
  assert.equal(anomalies[0]?.severity, "critical");
});

test("rejects invalid tolerance", () => {
  assert.throws(() => auditSettlementFees([], { toleranceAmount: -1 }));
});
