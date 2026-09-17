import assert from "node:assert/strict";
import test from "node:test";
import { buildClaimSlaWorklist, summarizeClaimSla } from "../src/claims/claimSlaWorklist.js";

const now = new Date("2026-09-17T10:00:00Z");
const claims = [
  { market: "naver", externalClaimId: "C1", type: "cancel", status: "requested", requestedAt: "2026-09-17T08:00:00Z", dueAt: "2026-09-17T09:00:00Z" },
  { market: "coupang", externalClaimId: "R1", type: "return", status: "reviewing", requestedAt: "2026-09-17T08:00:00Z", dueAt: "2026-09-17T11:00:00Z" },
  { market: "gmarket", externalClaimId: "E1", type: "exchange", status: "collecting", requestedAt: "2026-09-17T08:00:00Z", dueAt: "2026-09-18T08:00:00Z" }
] as const;

test("prioritizes overdue and near-due claims", () => {
  const rows = buildClaimSlaWorklist(claims, now);
  assert.deepEqual(rows.map((x) => x.urgency), ["overdue", "critical", "due_today"]);
});

test("summarizes SLA risk", () => {
  assert.deepEqual(summarizeClaimSla(claims, now), { total: 3, overdue: 1, critical: 1, dueToday: 1 });
});

test("rejects duplicate marketplace claims", () => {
  assert.throws(() => buildClaimSlaWorklist([claims[0], claims[0]], now), /duplicate claim/);
});
