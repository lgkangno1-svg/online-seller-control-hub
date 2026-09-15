import assert from "node:assert/strict";
import test from "node:test";
import type { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";
import { buildMarketRegistry } from "../src/markets/registry.js";

const readyCredentials = { ready: true } as unknown as EncryptedCredentialStore;
const disabledCredentials = { ready: false } as unknown as EncryptedCredentialStore;

test("live registry rejects markets without integration-tested write adapters", () => {
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials: readyCredentials, liveMarkets: ["lotteon"] }),
    /real write adapters have not passed integration testing: lotteon/
  );
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials: readyCredentials, liveMarkets: ["kakao"] }),
    /real write adapters have not passed integration testing: kakao/
  );
});

test("live registry fails closed without encrypted credential storage", () => {
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials: disabledCredentials, liveMarkets: ["naver"] }),
    /encrypted marketplace credential store/
  );
});

test("dry-run registry remains available without credentials and never enables live writes", () => {
  const registry = buildMarketRegistry({ dryRun: true, credentials: disabledCredentials, liveMarkets: ["lotteon", "kakao"] });
  assert.equal(registry.size, 6);
});
