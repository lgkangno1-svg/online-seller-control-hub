import assert from "node:assert/strict";
import test from "node:test";
import { buildShipmentExecutionPlan } from "../src/orders/shipmentExecutionPlan.js";

const shipments = [
  { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "1001" },
  { market: "coupang", orderLineId: "c-1", carrierCode: "HANJIN", trackingNumber: "2001" },
  { market: "naver", orderLineId: "n-2", carrierCode: "CJGLS", trackingNumber: "1002" },
  { market: "naver", orderLineId: "n-3", carrierCode: "CJGLS", trackingNumber: "1003" }
];

test("refuses to create an executable shipment plan without explicit confirmation", () => {
  assert.throws(() => buildShipmentExecutionPlan({ shipments, confirmed: false }), /explicit confirmation/);
});

test("summarizes bounded marketplace calls before execution", () => {
  const plan = buildShipmentExecutionPlan({ shipments, confirmed: true, maxItemsPerCall: 2 });
  assert.equal(plan.totalItems, 4);
  assert.equal(plan.totalApiCalls, 3);
  assert.equal(plan.pendingApiCalls, 3);
  assert.deepEqual(plan.markets, [
    { market: "naver", items: 3, apiCalls: 2 },
    { market: "coupang", items: 1, apiCalls: 1 }
  ]);
});

test("resumes only after a payload-bound confirmed checkpoint", () => {
  const initial = buildShipmentExecutionPlan({ shipments, confirmed: true, maxItemsPerCall: 1 });
  const checkpoint = initial.batches[1]!.retryKey;
  const resumed = buildShipmentExecutionPlan({
    shipments,
    confirmed: true,
    maxItemsPerCall: 1,
    lastSuccessfulRetryKey: checkpoint
  });
  assert.equal(resumed.totalApiCalls, 4);
  assert.equal(resumed.pendingApiCalls, 2);
  assert.deepEqual(resumed.batches.map((batch) => batch.retryKey), initial.batches.slice(2).map((batch) => batch.retryKey));
});
