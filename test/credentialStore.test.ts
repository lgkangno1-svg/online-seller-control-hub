import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStoreNotReadyError, EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

test("credentials are encrypted at rest and isolated by tenant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const path = join(dir, "credentials.json");
  const key = randomBytes(32).toString("base64");
  const store = await EncryptedCredentialStore.create(path, key);

  assert.equal(store.ready, true);
  await store.set("tenant-a", "naver", {
    clientId: "naver-client-a",
    clientSecret: "super-secret-a",
    accountId: "seller-uid-a"
  });

  const tenantA = store.statuses("tenant-a").find((item) => item.market === "naver");
  const tenantB = store.statuses("tenant-b").find((item) => item.market === "naver");
  assert.equal(tenantA?.configured, true);
  assert.equal(tenantB?.configured, false);
  assert.equal(store.get("tenant-b", "naver"), null);

  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("naver-client-a"), false);
  assert.equal(raw.includes("super-secret-a"), false);
  assert.equal(raw.includes("seller-uid-a"), false);

  const reloaded = await EncryptedCredentialStore.create(path, key);
  assert.deepEqual(reloaded.get("tenant-a", "naver"), {
    clientId: "naver-client-a",
    clientSecret: "super-secret-a",
    accountId: "seller-uid-a"
  });
});

test("credential storage fails closed without an encryption key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const store = await EncryptedCredentialStore.create(join(dir, "credentials.json"));
  assert.equal(store.ready, false);
  await assert.rejects(
    () => store.set("tenant-a", "toss", { accessKey: "a", secretKey: "b" }),
    CredentialStoreNotReadyError
  );
  assert.throws(() => store.get("tenant-a", "toss"), CredentialStoreNotReadyError);
});

test("credential store rejects invalid encryption key length", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  await assert.rejects(
    () => EncryptedCredentialStore.create(join(dir, "credentials.json"), Buffer.from("short-key").toString("base64")),
    /32-byte key/
  );
});

test("credential store restores a corrupted primary file from encrypted backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const path = join(dir, "credentials.json");
  const key = randomBytes(32).toString("base64");
  const store = await EncryptedCredentialStore.create(path, key);
  const naver = {
    clientId: "recover-client",
    clientSecret: "recover-secret",
    accountId: "recover-account"
  };

  await store.set("tenant-a", "naver", naver);
  await store.set("tenant-a", "toss", { accessKey: "toss-access", secretKey: "toss-secret" });

  const backup = await readFile(`${path}.bak`, "utf8");
  assert.equal(backup.includes("recover-client"), false);
  assert.equal(backup.includes("recover-secret"), false);
  assert.equal(backup.includes("recover-account"), false);

  await writeFile(path, "{corrupted", "utf8");
  const recovered = await EncryptedCredentialStore.create(path, key);
  assert.deepEqual(recovered.get("tenant-a", "naver"), naver);
  assert.equal(recovered.statuses("tenant-a").find((item) => item.market === "toss")?.configured, false);

  const restoredPrimary = await readFile(path, "utf8");
  assert.doesNotThrow(() => JSON.parse(restoredPrimary));
});

test("credential store fails closed when encrypted data is corrupt and no backup exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const path = join(dir, "credentials.json");
  const key = randomBytes(32).toString("base64");
  await writeFile(path, "not-json", "utf8");
  await assert.rejects(() => EncryptedCredentialStore.create(path, key));
});

test("failed credential set does not publish phantom state and later writes recover", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const path = join(dir, "credentials.json");
  const key = randomBytes(32).toString("base64");
  const store = await EncryptedCredentialStore.create(path, key);

  await mkdir(path);
  await assert.rejects(() => store.set("tenant-a", "toss", { accessKey: "access", secretKey: "secret" }));
  assert.equal(store.statuses("tenant-a").find((item) => item.market === "toss")?.configured, false);

  await rm(path, { recursive: true });
  await store.set("tenant-a", "toss", { accessKey: "access", secretKey: "secret" });
  assert.equal(store.statuses("tenant-a").find((item) => item.market === "toss")?.configured, true);

  const reloaded = await EncryptedCredentialStore.create(path, key);
  assert.deepEqual(reloaded.get("tenant-a", "toss"), { accessKey: "access", secretKey: "secret" });
});

test("failed credential removal preserves durable state and can be retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const path = join(dir, "credentials.json");
  const key = randomBytes(32).toString("base64");
  const store = await EncryptedCredentialStore.create(path, key);

  await store.set("tenant-a", "naver", {
    clientId: "client",
    clientSecret: "secret",
    accountId: "account"
  });
  await rm(path);
  await mkdir(path);

  await assert.rejects(() => store.remove("tenant-a", "naver"));
  assert.equal(store.statuses("tenant-a").find((item) => item.market === "naver")?.configured, true);

  await rm(path, { recursive: true });
  assert.equal(await store.remove("tenant-a", "naver"), true);
  assert.equal(store.statuses("tenant-a").find((item) => item.market === "naver")?.configured, false);
});

test("concurrent credential writes serialize without losing another market", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-credentials-"));
  const path = join(dir, "credentials.json");
  const key = randomBytes(32).toString("base64");
  const store = await EncryptedCredentialStore.create(path, key);

  await Promise.all([
    store.set("tenant-a", "naver", { clientId: "client", clientSecret: "secret", accountId: "account" }),
    store.set("tenant-a", "toss", { accessKey: "access", secretKey: "secret" })
  ]);

  const reloaded = await EncryptedCredentialStore.create(path, key);
  assert.equal(reloaded.statuses("tenant-a").find((item) => item.market === "naver")?.configured, true);
  assert.equal(reloaded.statuses("tenant-a").find((item) => item.market === "toss")?.configured, true);
});
