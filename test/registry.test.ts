import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoupangMarketAdapter } from "../src/markets/coupangAdapter.js";
import { DryRunMarketAdapter } from "../src/markets/dryRunAdapter.js";
import { buildMarketRegistry } from "../src/markets/registry.js";
import { UnavailableMarketAdapter } from "../src/markets/unavailableAdapter.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

async function store(withKey: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "seller-registry-"));
  return EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    withKey ? randomBytes(32).toString("base64") : undefined
  );
}

test("dry-run registry never enables live adapters", async () => {
  const credentials = await store(false);
  const registry = buildMarketRegistry({ dryRun: true, credentials, liveMarkets: ["coupang"] });
  assert.ok(registry.get("coupang") instanceof DryRunMarketAdapter);
  assert.ok(registry.get("naver") instanceof DryRunMarketAdapter);
});

test("live mode fails closed without encrypted credential storage", async () => {
  const credentials = await store(false);
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials, liveMarkets: ["coupang"] }),
    /encrypted marketplace credential store/
  );
});

test("live mode requires an explicit market allowlist", async () => {
  const credentials = await store(true);
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials, liveMarkets: [] }),
    /LIVE_MARKETS/
  );
});

test("only integration-tested allowlisted markets receive live adapters", async () => {
  const credentials = await store(true);
  const registry = buildMarketRegistry({ dryRun: false, credentials, liveMarkets: ["coupang"] });
  assert.ok(registry.get("coupang") instanceof CoupangMarketAdapter);
  assert.ok(registry.get("naver") instanceof UnavailableMarketAdapter);
  assert.ok(registry.get("gmarket") instanceof UnavailableMarketAdapter);
  assert.ok(registry.get("toss") instanceof UnavailableMarketAdapter);
  assert.ok(registry.get("lotteon") instanceof UnavailableMarketAdapter);
  assert.ok(registry.get("kakao") instanceof UnavailableMarketAdapter);
});

test("Naver SELF credentials can never be enabled for live writes", async () => {
  const credentials = await store(true);
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials, liveMarkets: ["naver"] }),
    /have not passed integration testing: naver/
  );
});

test("Gmarket cannot be enabled for live writes before SellerHub seller-tool approval", async () => {
  const credentials = await store(true);
  assert.throws(
    () => buildMarketRegistry({ dryRun: false, credentials, liveMarkets: ["gmarket"] }),
    /have not passed integration testing: gmarket/
  );
});
