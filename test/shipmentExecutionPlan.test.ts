import assert from "node:assert/strict";
import test from "node:test";
import { buildShipmentExecutionPlan, buildShipmentExecutionPreview } from "../src/orders/shipmentExecutionPlan.js";

const shipments = [
  { market: "naver", orderLineId: "n-1", carrierCode: "CJGLS", trackingNumber: "1001" },
  { market: "coupang", orderLineId: "c-1", carrierCode: "HANJIN", trackingNumber: "2001" },
  { market: "naver", orderLineId: "n-2", carrierCode: "CJGLS", trackingNumber: "1002" },
  { market: "naver", orderLineId: "n-3", carrierCode: "CJGLS", trackingNumber: "1003" }
];

function confirmedPlan(maxItemsPerCall = 2) {
  const preview = buildShipmentExecutionPreview({ shipments, maxItemsPerCall });
  return buildShipmentExecutionPlan({ shipments, confirmed: true, confirmedPlanKey: preview.confirmationKey, maxItemsPerCall });
}

test("refuses to create an executable shipment plan without explicit confirmation", () => {
  const preview = buildShipmentExecutionPreview({ shipments });
  assert.throws(() => buildShipmentExecutionPlan({ shipments, confirmed: false, confirmedPlanKey: preview.confirmationKey }), /explicit confirmation/);
});

test("requires confirmation to be bound to the exact shipment payload", () => {
  const preview = buildShipmentExecutionPreview({ shipments });
  const edited = shipments.map((item, index) => index === 0 ? { ...item, trackingNumber: "9999" } : item);
  assert.throws(
    () => buildShipmentExecutionPlan({ shipments: edited, confirmed: true, confirmedPlanKey: preview.confirmationKey }),
    /does not match the current payload/
  );
});

test("changing API chunk size invalidates a previous confirmation", () => {
  const preview = buildShipmentExecutionPreview({ shipments, maxItemsPerCall: 1 });
  assert.throws(
    () => buildShipmentExecutionPlan({ shipments, confirmed: true, confirmedPlanKey: preview.confirmationKey, maxItemsPerCall: 2 }),
    /does not match the current payload/
  );
});

test("summarizes bounded marketplace calls before execution", () => {
  const plan = confirmedPlan(2);
  assert.equal(plan.totalItems, 4);
  assert.equal(plan.totalApiCalls, 3);
  assert.equal(plan.pendingApiCalls, 3);
  assert.deepEqual(plan.markets, [
    { market: "naver", items: 3, apiCalls: 2 },
    { market: "coupang", items: 1, apiCalls: 1 }
  ]);
});

test("resumes only after a payload-bound confirmed checkpoint", () => {
  const initial = confirmedPlan(1);
  const checkpoint = initial.batches[1]!.retryKey;
  const resumed = buildShipmentExecutionPlan({
    shipments,
    confirmed: true,
    confirmedPlanKey: initial.confirmationKey,
    maxItemsPerCall: 1,
    lastSuccessfulRetryKey: checkpoint
  });
  assert.equal(resumed.totalApiCalls, 4);
  assert.equal(resumed.pendingApiCalls, 2);
  assert.deepEqual(resumed.batches.map((batch) => batch.retryKey), initial.batches.slice(2).map((batch) => batch.retryKey));
});

test("partial success checkpoints do not skip an earlier failed marketplace call", () => {
  const initial = confirmedPlan(1);
  const completedRetryKeys = [initial.batches[1]!.retryKey, initial.batches[3]!.retryKey];
  const resumed = buildShipmentExecutionPlan({
    shipments,
    confirmed: true,
    confirmedPlanKey: initial.confirmationKey,
    maxItemsPerCall: 1,
    completedRetryKeys
  });
  assert.equal(resumed.pendingApiCalls, 2);
  assert.deepEqual(resumed.batches.map((batch) => batch.retryKey), [initial.batches[0]!.retryKey, initial.batches[2]!.retryKey]);
});

test("rejects partial success checkpoints from another payload plan", () => {
  const initial = confirmedPlan(1);
  assert.throws(() => buildShipmentExecutionPlan({
    shipments,
    confirmed: true,
    confirmedPlanKey: initial.confirmationKey,
    maxItemsPerCall: 1,
    completedRetryKeys: ["naver:1/1:not-this-plan"]
  }), /does not belong to this batch plan/);
});

test("rejects ambiguous sequential and partial checkpoint modes", () => {
  const initial = confirmedPlan(1);
  assert.throws(() => buildShipmentExecutionPlan({
    shipments,
    confirmed: true,
    confirmedPlanKey: initial.confirmationKey,
    maxItemsPerCall: 1,
    lastSuccessfulRetryKey: initial.batches[0]!.retryKey,
    completedRetryKeys: [initial.batches[1]!.retryKey]
  }), /either lastSuccessfulRetryKey or completedRetryKeys/);
});
