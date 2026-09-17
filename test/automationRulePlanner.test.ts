import assert from "node:assert/strict";
import test from "node:test";
import { planAutomationActions, summarizeAutomationPlan } from "../src/automation/rulePlanner.js";

const signals = [
  {
    kind: "order_backlog",
    market: "naver",
    count: 20,
    threshold: 10,
    label: "Naver order backlog",
    detectedAt: "2026-09-17T05:00:00+00:00"
  },
  {
    kind: "stock_risk",
    market: "coupang",
    count: 8,
    threshold: 5,
    label: "Coupang stock risk",
    detectedAt: "2026-09-17T06:00:00+00:00"
  }
] as const;

test("creates safe notification proposals without confirmation", () => {
  const proposals = planAutomationActions({
    rules: [
      { id: "orders", kind: "order_backlog", minCount: 15, action: "notify_telegram" }
    ],
    signals
  });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.ruleId, "orders");
  assert.equal(proposals[0]?.requiresConfirmation, false);
  assert.equal(proposals[0]?.risk, "low");
  assert.equal(proposals[0]?.market, "naver");
});

test("keeps marketplace mutation proposals behind explicit confirmation", () => {
  const input = {
    rules: [
      { id: "stock-zero", kind: "stock_risk", market: "coupang", minCount: 5, action: "set_stock_zero" }
    ],
    signals
  };

  const proposals = planAutomationActions(input);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.requiresConfirmation, true);
  assert.equal(proposals[0]?.risk, "high");
  assert.deepEqual(summarizeAutomationPlan(input), {
    total: 1,
    confirmationRequired: 1,
    notifications: 0,
    marketplaceMutations: 1
  });
});

test("does not trigger disabled or below-threshold rules", () => {
  const proposals = planAutomationActions({
    rules: [
      { id: "disabled", kind: "order_backlog", action: "notify_telegram", enabled: false },
      { id: "too-high", kind: "order_backlog", minCount: 50, action: "request_review" }
    ],
    signals
  });

  assert.deepEqual(proposals, []);
});

test("rejects unsafe mutation rules and duplicate ids", () => {
  assert.throws(() => planAutomationActions({
    rules: [
      { id: "bad", kind: "order_backlog", market: "naver", action: "pause_listing" }
    ],
    signals
  }), /only allowed for stock-risk rules/);

  assert.throws(() => planAutomationActions({
    rules: [
      { id: "bad", kind: "stock_risk", action: "set_stock_zero" }
    ],
    signals
  }), /require an explicit market/);

  assert.throws(() => planAutomationActions({
    rules: [
      { id: "dup", kind: "claim_backlog", action: "notify_telegram" },
      { id: "dup", kind: "settlement_gap", action: "request_review" }
    ],
    signals
  }), /duplicate automation rule id/);
});
