import assert from "node:assert/strict";
import test from "node:test";
import { planOrderStatusTransitions, summarizeOrderStatusPlan } from "../src/orders/statusTransitionPlan.js";

const items = [
  { market: "naver", externalOrderLineId: "n1", fromStatus: "new", toStatus: "confirmed" },
  { market: "coupang", externalOrderLineId: "c1", fromStatus: "confirmed", toStatus: "preparing" },
  { market: "naver", externalOrderLineId: "n2", fromStatus: "preparing", toStatus: "cancelled", reason: "buyer request" }
] as const;

test("plans valid transitions behind confirmation", () => {
  const plan = planOrderStatusTransitions(items);
  assert.equal(plan.length, 3);
  assert.ok(plan.every((item) => item.requiresConfirmation));
  assert.equal(plan[2]?.risk, "high");
});

test("summarizes market workload and high risk cancellations", () => {
  const summary = summarizeOrderStatusPlan(items);
  assert.equal(summary.total, 3);
  assert.equal(summary.highRisk, 1);
  assert.equal(summary.byMarket.naver, 2);
  assert.equal(summary.byMarket.coupang, 1);
});

test("rejects impossible, no-op, and duplicate transitions", () => {
  assert.throws(() => planOrderStatusTransitions([{ ...items[0], fromStatus: "delivered", toStatus: "shipped" }]), /invalid order transition/);
  assert.throws(() => planOrderStatusTransitions([{ ...items[0], toStatus: "new" }]), /no-op order transition/);
  assert.throws(() => planOrderStatusTransitions([items[0], { ...items[0], toStatus: "cancelled" }]), /duplicate order transition/);
});
