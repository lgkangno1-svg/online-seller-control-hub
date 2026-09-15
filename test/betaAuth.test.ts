import assert from "node:assert/strict";
import test from "node:test";
import { BetaTokenAuth } from "../src/web/betaAuth.js";

const tester1 = "abcdefghijklmnopqrstuvwxyz123456";
const tester2 = "ZYXWVUTSRQPONMLKJIHGFEDCBA654321";
const disabled = "disabled-account-token-1234567890";

const auth = new BetaTokenAuth(JSON.stringify({
  "tester-1": { token: tester1, tenantId: "tenant-a", plan: "beta", enabled: true },
  "tester-2": { token: tester2, tenantId: "tenant-b", plan: "pro", enabled: true },
  "tester-off": { token: disabled, tenantId: "tenant-c", plan: "beta", enabled: false }
}));

test("beta token authenticates with tenant and plan identity", () => {
  assert.deepEqual(auth.authenticate(`Bearer ${tester1}`), { userId: "tester-1", tenantId: "tenant-a", plan: "beta" });
  assert.deepEqual(auth.authenticate(`Bearer ${tester2}`), { userId: "tester-2", tenantId: "tenant-b", plan: "pro" });
});

test("disabled, invalid or missing beta token is rejected", () => {
  assert.equal(auth.authenticate(undefined), null);
  assert.equal(auth.authenticate("Basic abc"), null);
  assert.equal(auth.authenticate(`Bearer ${disabled}`), null);
  assert.equal(auth.authenticate("Bearer not-a-real-beta-token-123456"), null);
});

test("legacy token map remains backward compatible", () => {
  const legacy = new BetaTokenAuth(JSON.stringify({ legacy: tester1 }));
  assert.deepEqual(legacy.authenticate(`Bearer ${tester1}`), { userId: "legacy", tenantId: "demo", plan: "beta" });
});
