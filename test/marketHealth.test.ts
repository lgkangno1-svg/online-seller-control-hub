import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMarketHealth } from "../src/reporting/marketHealth.js";

test("classifies latest marketplace health samples", () => {
  const rows = summarizeMarketHealth([
    { market: "naver", checkedAt: "2026-09-17T06:00:00+00:00", authOk: true, latencyMs: 200, consecutiveFailures: 0, rateLimited: false },
    { market: "coupang", checkedAt: "2026-09-17T06:00:00+00:00", authOk: true, latencyMs: 200, consecutiveFailures: 0, rateLimited: true },
    { market: "gmarket", checkedAt: "2026-09-17T06:00:00+00:00", authOk: false, latencyMs: 0, consecutiveFailures: 1, rateLimited: false },
  ]);
  assert.equal(rows.find((row) => row.market === "naver")?.status, "healthy");
  assert.equal(rows.find((row) => row.market === "coupang")?.status, "degraded");
  assert.equal(rows.find((row) => row.market === "gmarket")?.status, "down");
  assert.equal(rows.find((row) => row.market === "lotteon")?.status, "unknown");
});
