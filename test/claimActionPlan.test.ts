import assert from "node:assert/strict";
import test from "node:test";
import { planClaimActions, summarizeClaimActionPlan } from "../src/claims/claimActionPlan.js";

test("plans bounded claim mutations behind explicit confirmation", () => {
  const requests = [
    {
      market: "naver",
      externalClaimId: "cancel-1",
      orderLineId: "line-1",
      type: "cancel",
      status: "requested",
      action: "approve"
    },
    {
      market: "coupang",
      externalClaimId: "return-1",
      orderLineId: "line-2",
      type: "return",
      status: "requested",
      action: "request_collection"
    }
  ];
  const plan = planClaimActions(requests);

  assert.equal(plan.length, 2);
  assert.equal(plan[0]?.requiresConfirmation, true);
  assert.equal(plan[0]?.risk, "high");
  assert.equal(plan[1]?.risk, "medium");

  assert.deepEqual(summarizeClaimActionPlan(requests), {
    total: 2,
    highRisk: 1,
    mediumRisk: 1,
    confirmationRequired: 2,
    byMarket: { naver: 1, coupang: 1 }
  });
});

test("rejects illegal terminal-state transitions", () => {
  assert.throws(() => planClaimActions([
    {
      market: "naver",
      externalClaimId: "return-2",
      orderLineId: "line-3",
      type: "return",
      status: "completed",
      action: "complete"
    }
  ]), /action is not allowed/);
});

test("requires a note when rejecting a claim", () => {
  assert.throws(() => planClaimActions([
    {
      market: "gmarket",
      externalClaimId: "exchange-1",
      orderLineId: "line-4",
      type: "exchange",
      status: "requested",
      action: "reject"
    }
  ]), /rejection requires a reason note/);
});

test("blocks duplicate marketplace claim mutations in one plan", () => {
  assert.throws(() => planClaimActions([
    {
      market: "toss",
      externalClaimId: "claim-1",
      orderLineId: "line-5",
      type: "cancel",
      status: "requested",
      action: "approve"
    },
    {
      market: "toss",
      externalClaimId: "claim-1",
      orderLineId: "line-5",
      type: "cancel",
      status: "requested",
      action: "reject",
      note: "customer changed request"
    }
  ]), /duplicate marketplace claim action/);
});
