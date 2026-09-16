import assert from "node:assert/strict";
import test from "node:test";
import { groupClaimsByMarket, normalizeClaimInbox, summarizeClaimInbox } from "../src/orders/claimInbox.js";

const claims = [
  { market: "naver", externalClaimId: "n-return-1", orderLineId: "n-1", type: "return", status: "requested", reason: "changed mind", requestedAt: "2026-09-16T08:00:00+09:00" },
  { market: "coupang", externalClaimId: "c-cancel-1", orderLineId: "c-1", type: "cancel", status: "completed", requestedAt: "2026-09-16T09:00:00+09:00" },
  { market: "naver", externalClaimId: "n-exchange-1", orderLineId: "n-2", type: "exchange", status: "processing", requestedAt: "2026-09-16T10:00:00+09:00" }
] as const;

test("normalizes claims into newest-first unified inbox", () => {
  assert.deepEqual(normalizeClaimInbox(claims).map((claim) => claim.externalClaimId), ["n-exchange-1", "c-cancel-1", "n-return-1"]);
});

test("groups normalized claims by marketplace", () => {
  const groups = groupClaimsByMarket(claims);
  assert.deepEqual(groups.map((group) => [group.market, group.items.length]), [["naver", 2], ["coupang", 1]]);
});

test("summarizes claim workload without executing marketplace writes", () => {
  assert.deepEqual(summarizeClaimInbox(claims), { total: 3, actionable: 2, byType: { cancel: 1, return: 1, exchange: 1 } });
});

test("rejects duplicate marketplace claim ids", () => {
  assert.throws(() => normalizeClaimInbox([claims[0], { ...claims[0], orderLineId: "other" }]), /duplicate marketplace claim/);
});

test("rejects unknown claim states", () => {
  assert.throws(() => normalizeClaimInbox([{ ...claims[0], status: "mystery" }]));
});
