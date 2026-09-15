import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MarketplaceAccountAlreadyLinkedError,
  MarketplaceLinkStore,
  MarketplaceLinkStoreNotReadyError,
  MarketplaceRelinkRequiredError
} from "../src/persistence/marketLinkStore.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-links-"));
  const path = join(dir, "market-links.enc.json");
  const key = randomBytes(32).toString("base64");
  return { path, key };
}

test("delegated seller identifiers are encrypted at rest and survive reload", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "sensitive-account-uid", "naver_solution_jwt");

  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("sensitive-account-uid"), false);
  assert.equal(raw.includes("naver_solution_jwt"), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  const reloaded = await MarketplaceLinkStore.create(path, key);
  const link = reloaded.get("tenant-a", "naver");
  assert.equal(link?.externalAccountId, "sensitive-account-uid");
  assert.equal(link?.source, "naver_solution_jwt");
  assert.equal(reloaded.statuses("tenant-a").find((item) => item.market === "naver")?.linked, true);
});

test("corrupt primary recovers from last known-good backup", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "account-a", "naver_solution_jwt");
  await store.set("tenant-a", "naver", "account-a", "naver_solution_jwt");

  await writeFile(path, "{broken", "utf8");
  const recovered = await MarketplaceLinkStore.create(path, key);
  assert.equal(recovered.get("tenant-a", "naver")?.externalAccountId, "account-a");
});

test("store fails closed when both primary and backup are corrupt", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "account-a", "naver_solution_jwt");
  await store.set("tenant-a", "naver", "account-a", "naver_solution_jwt");
  await writeFile(path, "{broken-primary", "utf8");
  await writeFile(`${path}.bak`, "{broken-backup", "utf8");
  await assert.rejects(() => MarketplaceLinkStore.create(path, key));
});

test("link store rejects writes without an encryption key", async () => {
  const { path } = await fixture();
  const store = await MarketplaceLinkStore.create(path);
  await assert.rejects(
    () => store.set("tenant-a", "naver", "account", "source"),
    MarketplaceLinkStoreNotReadyError
  );
});

test("the same marketplace seller account cannot be linked to another tenant", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "seller-uid", "naver_solution_jwt");
  await assert.rejects(
    () => store.set("tenant-b", "naver", "seller-uid", "naver_solution_jwt"),
    MarketplaceAccountAlreadyLinkedError
  );
  assert.equal(store.tenantForExternalAccountId("naver", "seller-uid"), "tenant-a");
});

test("replacing a tenant's seller account requires explicit unlink first", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "seller-a", "naver_solution_jwt");
  await assert.rejects(
    () => store.set("tenant-a", "naver", "seller-b", "naver_solution_jwt"),
    MarketplaceRelinkRequiredError
  );
  assert.equal(store.get("tenant-a", "naver")?.externalAccountId, "seller-a");
});

test("remove clears only the requested tenant market link", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "a", "naver_solution_jwt");
  await store.set("tenant-b", "naver", "b", "naver_solution_jwt");
  assert.equal(await store.remove("tenant-a", "naver"), true);
  assert.equal(store.get("tenant-a", "naver"), null);
  assert.equal(store.get("tenant-b", "naver")?.externalAccountId, "b");
});

test("failed delegated link write does not publish phantom state and later writes recover", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);

  await mkdir(path);
  await assert.rejects(() => store.set("tenant-a", "naver", "seller-a", "naver_solution_jwt"));
  assert.equal(store.statuses("tenant-a").find((item) => item.market === "naver")?.linked, false);
  assert.equal(store.tenantForExternalAccountId("naver", "seller-a"), null);

  await rm(path, { recursive: true });
  await store.set("tenant-a", "naver", "seller-a", "naver_solution_jwt");
  assert.equal(store.statuses("tenant-a").find((item) => item.market === "naver")?.linked, true);

  const reloaded = await MarketplaceLinkStore.create(path, key);
  assert.equal(reloaded.get("tenant-a", "naver")?.externalAccountId, "seller-a");
});

test("failed delegated unlink preserves durable state and can be retried", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);
  await store.set("tenant-a", "naver", "seller-a", "naver_solution_jwt");

  await rm(path);
  await mkdir(path);
  await assert.rejects(() => store.remove("tenant-a", "naver"));
  assert.equal(store.get("tenant-a", "naver")?.externalAccountId, "seller-a");

  await rm(path, { recursive: true });
  assert.equal(await store.remove("tenant-a", "naver"), true);
  assert.equal(store.get("tenant-a", "naver"), null);
});

test("concurrent delegated links cannot assign one seller account to two tenants", async () => {
  const { path, key } = await fixture();
  const store = await MarketplaceLinkStore.create(path, key);

  const results = await Promise.allSettled([
    store.set("tenant-a", "naver", "shared-seller", "naver_solution_jwt"),
    store.set("tenant-b", "naver", "shared-seller", "naver_solution_jwt")
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof MarketplaceAccountAlreadyLinkedError);

  const owner = store.tenantForExternalAccountId("naver", "shared-seller");
  assert.ok(owner === "tenant-a" || owner === "tenant-b");
  const other = owner === "tenant-a" ? "tenant-b" : "tenant-a";
  assert.equal(store.get(other, "naver"), null);

  const reloaded = await MarketplaceLinkStore.create(path, key);
  assert.equal(reloaded.tenantForExternalAccountId("naver", "shared-seller"), owner);
  assert.equal(reloaded.get(other, "naver"), null);
});
