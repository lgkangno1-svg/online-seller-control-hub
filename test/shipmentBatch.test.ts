import assert from "node:assert/strict";
import test from "node:test";
import { chunkShipmentBatchByMarket, groupShipmentBatchByMarket, resumeShipmentApiBatches, validateShipmentBatch } from "../src/orders/shipmentBatch.js";

test("accepts a bounded shipment batch", () => {
  const batch = validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "CJGLS", trackingNumber: "1234567890" },
    { market: "coupang", orderLineId: "line-2", carrierCode: "HANJIN", trackingNumber: "ABC-1234" }
  ]);
  assert.equal(batch.length, 2);
});

test("normalizes carrier codes before fingerprinting and duplicate checks", () => {
  const normalized = validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: " cjgls ", trackingNumber: "1234567890" }
  ]);
  assert.equal(normalized[0]?.carrierCode, "CJGLS");

  assert.throws(() => validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "cjgls", trackingNumber: "1234567890" },
    { market: "naver", orderLineId: "line-2", carrierCode: "CJGLS", trackingNumber: "1234567890" }
  ]), /tracking number is assigned/);
  assert.throws(() => validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "CJ GLS", trackingNumber: "1234567890" }
  ]), /carrier code contains unsupported characters/);
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

test("chunks each marketplace independently with payload-bound retry keys", () => {
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
  assert.match(batches[0]!.retryKey, /^naver:1\/2:[a-f0-9]{16}$/);
  assert.equal(new Set(batches.map((batch) => batch.retryKey)).size, batches.length);
});

test("resumes after the exact last successful shipment API chunk", () => {
  const input = [
    { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "1001" },
    { market: "naver", orderLineId: "n-2", carrierCode: "CJGLS", trackingNumber: "1002" },
    { market: "naver", orderLineId: "n-3", carrierCode: "CJGLS", trackingNumber: "1003" },
    { market: "coupang", orderLineId: "c-1", carrierCode: "HANJIN", trackingNumber: "2001" }
  ] as const;
  const batches = chunkShipmentBatchByMarket(input, 2);
  assert.deepEqual(resumeShipmentApiBatches(batches, batches[0]!.retryKey).map((batch) => batch.retryKey), batches.slice(1).map((batch) => batch.retryKey));
  assert.throws(() => resumeShipmentApiBatches(batches, "naver:9/9:0000000000000000"), /does not belong/);
});

test("rejects a checkpoint when shipment payload changed", () => {
  const original = chunkShipmentBatchByMarket([
    { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "1001" },
    { market: "naver", orderLineId: "n-2", carrierCode: "CJGLS", trackingNumber: "1002" }
  ], 1);
  const edited = chunkShipmentBatchByMarket([
    { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "9999" },
    { market: "naver", orderLineId: "n-2", carrierCode: "CJGLS", trackingNumber: "1002" }
  ], 1);
  assert.notEqual(original[0]!.retryKey, edited[0]!.retryKey);
  assert.throws(() => resumeShipmentApiBatches(edited, original[0]!.retryKey), /does not belong/);
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
