import assert from "node:assert/strict";
import test from "node:test";
import { buildCarrierManifest, summarizeCarrierManifest } from "../src/orders/carrierManifest.js";

test("builds bounded carrier manifest", () => {
  const input = [{ market: "naver", externalOrderLineId: "o-1", carrierCode: "CJ", invoiceNumber: "1234567890", shippedAt: "2026-09-17T12:00:00Z" }];
  assert.equal(buildCarrierManifest(input)[0]?.requiresConfirmation, true);
  assert.equal(summarizeCarrierManifest(input).byCarrier.CJ, 1);
});

test("rejects duplicate shipment lines", () => {
  const row = { market: "naver", externalOrderLineId: "o-1", carrierCode: "CJ", invoiceNumber: "1234567890", shippedAt: "2026-09-17T12:00:00Z" };
  assert.throws(() => buildCarrierManifest([row, row]), /duplicate shipment line/);
});
