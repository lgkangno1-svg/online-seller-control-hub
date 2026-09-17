import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketSyncDashboard, summarizeMarketSyncDashboard } from "../src/reporting/marketSyncDashboard.js";

test("prioritizes auth and failed sync incidents", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const input = [{ market: "naver", domain: "orders", lastSuccessAt: "2026-09-17T11:55:00Z", pending: 2, failed: 0, authHealthy: true }, { market: "coupang", domain: "inventory", pending: 0, failed: 1, authHealthy: true }];
  const rows = buildMarketSyncDashboard(input, now);
  assert.equal(rows[0]?.severity, "critical");
  assert.equal(summarizeMarketSyncDashboard(input, now).critical, 1);
});
