import assert from "node:assert/strict";
import test from "node:test";
import { validateShipmentBatch } from "../src/orders/shipmentBatch.js";

test("accepts a bounded shipment batch", () => {
  const batch = validateShipmentBatch([
    { market: "naver", orderLineId: "line-1", carrierCode: "CJGLS", trackingNumber: "1234567890" },
    { market: "coupang", orderLineId: "line-2", carrierCode: "HANJIN", trackingNumber: "ABC-1234" }
  ]);
  assert.equal(batch.length, 2);
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
