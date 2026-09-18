import assert from "node:assert/strict";
import test from "node:test";
import { buildReturnInspectionWorklist } from "../src/claims/returnInspectionWorklist.js";

test("prioritizes overdue and high-value returns", () => {
  const rows = buildReturnInspectionWorklist([
    { claimId: "normal", market: "naver", receivedAt: "2026-09-18T00:00:00Z", refundAmount: 20_000 },
    { claimId: "overdue", market: "coupang", expectedAt: "2026-09-16T00:00:00Z", refundAmount: 150_000 },
  ], new Date("2026-09-18T03:00:00Z"));
  assert.equal(rows[0]?.claimId, "overdue");
  assert.equal(rows[0]?.action, "ESCALATE");
  assert.equal(rows[0]?.requiresApproval, true);
  assert.equal(rows[1]?.action, "INSPECT");
});
