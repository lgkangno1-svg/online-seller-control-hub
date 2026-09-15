import assert from "node:assert/strict";
import test from "node:test";
import { MARKETS } from "../src/core/types.js";
import {
  MARKET_ONBOARDING_POLICIES,
  marketOnboardingPolicies
} from "../src/markets/onboardingPolicy.js";

test("market onboarding policy covers every marketplace exactly once", () => {
  const policies = marketOnboardingPolicies();
  assert.equal(policies.length, MARKETS.length);
  assert.deepEqual(policies.map((item) => item.market), [...MARKETS]);
});

test("only Naver currently advertises delegated one-click onboarding", () => {
  const delegated = marketOnboardingPolicies().filter((item) => item.experience === "one_click");
  assert.deepEqual(delegated.map((item) => item.market), ["naver"]);
  assert.equal(MARKET_ONBOARDING_POLICIES.naver.sellerSecretRequired, false);
  assert.equal(MARKET_ONBOARDING_POLICIES.naver.commercialReady, false);
});

test("seller-issued key providers stay explicit instead of pretending OAuth exists", () => {
  for (const market of ["coupang", "toss"] as const) {
    const policy = MARKET_ONBOARDING_POLICIES[market];
    assert.equal(policy.mode, "seller_credentials");
    assert.equal(policy.experience, "one_time_key");
    assert.equal(policy.sellerSecretRequired, true);
  }
});

test("Gmarket stays operator-mapping gated and LotteON stays fail-closed", () => {
  assert.equal(MARKET_ONBOARDING_POLICIES.gmarket.mode, "operator_mapping");
  assert.equal(MARKET_ONBOARDING_POLICIES.gmarket.commercialReady, false);
  assert.equal(MARKET_ONBOARDING_POLICIES.lotteon.mode, "policy_unverified");
  assert.equal(MARKET_ONBOARDING_POLICIES.lotteon.experience, "blocked");
  assert.equal(MARKET_ONBOARDING_POLICIES.lotteon.commercialReady, false);
});

test("public onboarding metadata contains no credential values", () => {
  const serialized = JSON.stringify(marketOnboardingPolicies()).toLowerCase();
  for (const suspicious of ["clientsecret\":", "secretkey\":", "accesskey\":", "adminappkey\":", "sellerappkey\":"]) {
    assert.equal(serialized.includes(suspicious), false);
  }
});
