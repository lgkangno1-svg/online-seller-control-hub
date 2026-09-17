import assert from "node:assert/strict";
import test from "node:test";
import { planOperationRetries, summarizeOperationRetryQueue } from "../src/operations/retryQueue.js";

const now = new Date("2026-09-17T06:00:00.000Z");

test("allows automatic retry only for safe read operations", () => {
  const plan = planOperationRetries([
    {
      operationId: "orders-1",
      market: "naver",
      kind: "order_fetch",
      failureClass: "rate_limited",
      attempts: 1,
      failedAt: "2026-09-17T05:55:00+00:00"
    },
    {
      operationId: "shipment-1",
      market: "coupang",
      kind: "shipment_write",
      failureClass: "transient",
      attempts: 1,
      failedAt: "2026-09-17T05:54:00+00:00"
    }
  ], now);

  const read = plan.find((item) => item.operationId === "orders-1");
  const write = plan.find((item) => item.operationId === "shipment-1");
  assert.equal(read?.disposition, "retry_ready");
  assert.equal(read?.automaticRetryAllowed, true);
  assert.equal(read?.requiresConfirmation, false);
  assert.equal(write?.disposition, "retry_ready");
  assert.equal(write?.automaticRetryAllowed, false);
  assert.equal(write?.requiresConfirmation, true);
});

test("keeps ambiguous writes and validation failures in manual review", () => {
  const plan = planOperationRetries([
    {
      operationId: "product-1",
      market: "gmarket",
      kind: "product_write",
      failureClass: "ambiguous_write",
      attempts: 1,
      failedAt: "2026-09-17T05:50:00+00:00"
    },
    {
      operationId: "claim-1",
      market: "toss",
      kind: "claim_write",
      failureClass: "validation",
      attempts: 1,
      failedAt: "2026-09-17T05:49:00+00:00"
    }
  ], now);

  assert.equal(plan[0]?.disposition, "manual_review");
  assert.equal(plan[1]?.disposition, "manual_review");
  assert.equal(plan.every((item) => item.requiresConfirmation), true);
});

test("honors retry schedules and attempt exhaustion", () => {
  const input = [
    {
      operationId: "later",
      market: "naver",
      kind: "settlement_fetch",
      failureClass: "transient",
      attempts: 2,
      maxAttempts: 5,
      failedAt: "2026-09-17T05:58:00+00:00",
      nextRetryAt: "2026-09-17T06:05:00+00:00"
    },
    {
      operationId: "done",
      market: "coupang",
      kind: "order_fetch",
      failureClass: "rate_limited",
      attempts: 3,
      maxAttempts: 3,
      failedAt: "2026-09-17T05:57:00+00:00"
    }
  ];

  assert.deepEqual(summarizeOperationRetryQueue(input, now), {
    total: 2,
    retryReady: 0,
    retryWaiting: 1,
    manualReview: 0,
    exhausted: 1,
    automaticRetryAllowed: 0,
    confirmationRequired: 0,
    byMarket: { naver: 1, coupang: 1 }
  });
});

test("rejects duplicate failures and impossible attempt counts", () => {
  assert.throws(() => planOperationRetries([
    { operationId: "same", market: "naver", kind: "order_fetch", failureClass: "transient", attempts: 1, failedAt: "2026-09-17T05:00:00+00:00" },
    { operationId: "same", market: "naver", kind: "order_fetch", failureClass: "transient", attempts: 2, failedAt: "2026-09-17T05:01:00+00:00" }
  ], now), /duplicate marketplace operation failure/);

  assert.throws(() => planOperationRetries([
    { operationId: "bad", market: "toss", kind: "order_fetch", failureClass: "transient", attempts: 6, maxAttempts: 5, failedAt: "2026-09-17T05:00:00+00:00" }
  ], now), /attempts cannot exceed maxAttempts/);
});
