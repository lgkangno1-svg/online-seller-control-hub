import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketListingMatrix, summarizeMarketListings } from "../src/catalog/marketListingMatrix.js";

const rows = [
  { masterSku: "SKU-1", market: "naver", externalId: "N1", status: "active", price: 10000, stock: 5, lastSyncedAt: "2026-09-17T09:00:00+09:00" },
  { masterSku: "SKU-1", market: "coupang", status: "rejected", error: "category mapping required" }
] as const;

test("builds one master SKU row across marketplaces", () => {
  const matrix = buildMarketListingMatrix(rows);
  assert.equal(matrix.length, 1);
  assert.equal(matrix[0]?.markets.naver?.externalId, "N1");
  assert.equal(matrix[0]?.markets.coupang?.status, "rejected");
});

test("summarizes listing coverage and attention", () => {
  const summary = summarizeMarketListings(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.active, 1);
  assert.equal(summary.attention, 1);
  assert.equal(summary.stale, 1);
});

test("rejects duplicate sku-market listing", () => {
  assert.throws(() => buildMarketListingMatrix([rows[0], rows[0]]), /duplicate listing/);
});
