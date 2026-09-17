import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderAgingWorklist } from "../src/orders/orderAgingWorklist.js";

test("prioritizes overdue and aging active orders", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const rows = buildOrderAgingWorklist([
    { orderId: "late", market: "naver", status: "paid", statusSince: "2026-09-17T20:00:00Z", promisedShipAt: "2026-09-17T23:00:00Z" },
    { orderId: "old", market: "coupang", status: "paid", statusSince: "2026-09-16T20:00:00Z" },
    { orderId: "done", market: "naver", status: "delivered", statusSince: "2026-09-10T00:00:00Z" },
  ], now);
  assert.deepEqual(rows.map((row) => row.orderId), ["late", "old"]);
  assert.equal(rows[0]?.priority, "critical");
  assert.equal(rows[1]?.ageHours, 28);
  assert.equal(rows[1]?.priority, "high");
});
