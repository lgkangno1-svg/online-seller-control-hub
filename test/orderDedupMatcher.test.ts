import assert from "node:assert/strict";
import test from "node:test";
import { matchDuplicateOrders } from "../src/orders/orderDedupMatcher.js";

test("detects exact and suspicious duplicate order lines", () => {
  const base = { market: "naver" as const, externalOrderId: "o1", externalOrderLineId: "l1", masterSku: "SKU-1", quantity: 1, orderedAt: "2026-09-17T12:00:00+09:00" };
  const result = matchDuplicateOrders([base, base, { ...base, externalOrderLineId: "l2" }]);
  assert.equal(result.totalLines, 3);
  assert.equal(result.uniqueLines, 2);
  assert.equal(result.exactDuplicates.length, 1);
  assert.equal(result.suspiciousDuplicates.length, 1);
});
