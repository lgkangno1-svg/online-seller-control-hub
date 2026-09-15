import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountStore } from "../src/persistence/accountStore.js";

test("failed signup persistence does not publish memory state and later writes can recover", async () => {
  const root = await mkdtemp(join(tmpdir(), "sellerhub-account-failure-"));
  const dataDir = join(root, "data");
  const path = join(dataDir, "accounts.json");
  try {
    const store = await AccountStore.load(path, 7);
    await writeFile(dataDir, "block directory creation", "utf8");

    await assert.rejects(
      store.requestSignup({ email: "failed@example.com", password: "FailedPass1234" })
    );
    assert.equal(store.listSignupRequests().length, 0);
    assert.equal(store.accountCount(), 0);

    await rm(dataDir, { force: true });
    await mkdir(dataDir, { recursive: true });
    const retry = await store.requestSignup({ email: "failed@example.com", password: "FailedPass1234" });
    assert.equal(retry.status, "pending");
    assert.equal(store.listSignupRequests().length, 1);

    const restarted = await AccountStore.load(path, 7);
    assert.equal(restarted.listSignupRequests().length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed approval persistence leaves the signup pending until a durable retry succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "sellerhub-account-approval-failure-"));
  const dataDir = join(root, "data");
  const path = join(dataDir, "accounts.json");
  try {
    const store = await AccountStore.load(path, 7);
    const request = await store.requestSignup({ email: "pending@example.com", password: "PendingPass1234" });

    await rm(dataDir, { recursive: true, force: true });
    await writeFile(dataDir, "block directory creation", "utf8");
    await assert.rejects(store.approveSignup(request.userId));
    assert.equal(store.listSignupRequests()[0]?.status, "pending");

    await rm(dataDir, { force: true });
    await mkdir(dataDir, { recursive: true });
    const approved = await store.approveSignup(request.userId);
    assert.equal(approved.status, "active");
    assert.equal(store.listSignupRequests().length, 0);

    const restarted = await AccountStore.load(path, 7);
    const session = await restarted.login("pending@example.com", "PendingPass1234");
    assert.equal(session.identity.status, "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
