import assert from "node:assert/strict";
import test from "node:test";
import { buildListingReadinessReport, summarizeListingReadiness } from "../src/catalog/listingReadiness.js";

test("reports listing blockers without mutating marketplaces", () => {
  const input = [
    { masterSku: "SKU-1", name: "Ready", salePrice: 10000, stock: 3, imageUrls: ["https://example.com/a.jpg"], categoryCode: "500", markets: { naver: { externalId: "N1" } } },
    { masterSku: "SKU-2", name: "Blocked", imageUrls: [], markets: {} },
  ];
  const rows = buildListingReadinessReport(input);
  assert.equal(rows[0]?.ready, true);
  assert.deepEqual(rows[0]?.connectedMarkets, ["naver"]);
  assert.equal(rows[1]?.ready, false);
  assert.deepEqual(rows[1]?.issues, ["missing_sale_price", "missing_stock", "missing_image", "missing_category"]);
  assert.deepEqual(summarizeListingReadiness(input), { total: 2, ready: 1, blocked: 1, issueCount: 4 });
});
