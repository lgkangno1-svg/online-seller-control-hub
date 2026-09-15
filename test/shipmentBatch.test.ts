import assert from "node:assert/strict";
import test from "node:test";
import { chunkShipmentBatchByMarket, groupShipmentBatchByMarket, validateShipmentBatch } from "../src/orders/shipmentBatch.js";

test("accepts a bounded shipment batch", () => {
  const batch = validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "CJGLS", trackingNumber: "1234567890" },
    { market: "coupang", orderLineId: "line-2", carrierCode: "HANJIN", trackingNumber: "ABC-1234" }
  ]);
  assert.equal(batch.length, 2);
});

test("groups a mixed shipment batch by marketplace without reordering each market", () => {
  const groups = groupShipmentBatchByMarket([
    { market: "naver", orderLineId: "naver-1", carrierCode: "CJGLS", trackingNumber: "1234567890" },
    { market: "coupang", orderLineId: "coupang-1", carrierCode: "HANJIN", trackingNumber: "2234567890" },
    { market: "naver", orderLineId: "naver-2", carrierCode: "CJGLS", trackingNumber: "3234567890" }
  ]);
  assert.deepEqual(groups.map((group) => group.market), ["naver", "coupang"]);
  assert.deepEqual(groups[0]?.items.map((item) => item.orderLineId), ["naver-1", "naver-2"]);
  assert.deepEqual(groups[1]?.items.map((item) => item.orderLineId), ["coupang-1"]);
});

test("chunks each marketplace independently for bounded API calls", () => {
  const batches = chunkShipmentBatchByMarket([
    { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "1001" },
    { market: "coupang", orderLineId: "c-1", carrierCode: "HANJIN", trackingNumber: "2001" },
    { market: "naver", orderLineId: "n-2", carrierCode: "CJGLS", trackingNumber: "1002" },
    { market: "naver", orderLineId: "n-3", carrierCode: "CJGLS", trackingNumber: "1003" }
  ], 2);
  assert.deepEqual(batches.map((batch) => [batch.market, batch.batchIndex, batch.batchCount, batch.items.map((item) => item.orderLineId)]), [
    ["naver", 0, 2, ["n-1", "n-2"]],
    ["naver", 1, 2, ["n-3"]],
    ["coupang", 0, 1, ["c-1"]]
  ]);
});

test("rejects invalid marketplace API chunk limits", () => {
  assert.throws(() => chunkShipmentBatchByMarket([
    { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "1001" }
  ], 0), /maxItemsPerCall/);
});

test("rejects duplicate order lines", () => {
  assert.throws(() => validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "CJGLS", trackingNumber: "1234567890" },
    { market: "naver", orderLineId: "line-1", carrierCode: "CJGLS", trackingNumber: "1234567891" }
  ]), /duplicate order line/);
});

test("rejects one tracking number assigned to multiple order lines", () => {
  assert.throws(() => validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "CJGLS", trackingNumber: "1234567890" },
    { market: "naver", orderLineId: "line-2", carrierCode: "CJGLS", trackingNumber: "1234567890" }
  ]), /tracking number is assigned/);
});

test("rejects oversized batches before any marketplace write", () => {
  const batch = Array.from({ length: 501 }, (_, index) => ({
    market: "naver",
    orderLineId: `line-${index}`,
    carrierCode: "CJGLS",
    trackingNumber: `1000${index}`
  }));
  assert.throws(() => validateShipmentBatch(batch));
});
