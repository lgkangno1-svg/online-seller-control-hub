import assert from "node:assert/strict";
import test from "node:test";
import { diffChannelListings } from "../src/catalog/channelListingDiff.js";

test("detects per-market drift and flags large price changes", () => {
  const diffs = diffChannelListings(
    [{ sku: "A", price: 10_000, stock: 5, title: "상품 A" }],
    [
      { sku: "A", market: "naver", price: 10_000, stock: 4, title: "상품 A" },
      { sku: "A", market: "coupang", price: 13_000, stock: 5, title: "상품 A 구형" },
    ],
  );
  assert.deepEqual(diffs[0]?.changedFields, ["stock"]);
  assert.equal(diffs[0]?.requiresApproval, false);
  assert.deepEqual(diffs[1]?.changedFields, ["price", "title"]);
  assert.equal(diffs[1]?.requiresApproval, true);
});
