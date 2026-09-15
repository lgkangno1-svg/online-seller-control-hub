import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountStore } from "../src/persistence/accountStore.js";

async function withStore(run: (store: AccountStore, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-accounts-"));
  const path = join(dir, "accounts.json");
  try {
    const store = await AccountStore.load(path, 7);
    await run(store, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("signup request remains pending until an administrator approves it", async () => {
  await withStore(async (store) => {
    const request = await store.requestSignup({ email: "seller@example.com", password: "SellerPass1234" });
    assert.equal(request.status, "pending");
    assert.equal(store.listSignupRequests().length, 1);

    await assert.rejects(
      store.login("seller@example.com", "SellerPass1234"),
      /승인 대기/
    );

    const approved = await store.approveSignup(request.userId);
    assert.equal(approved.status, "active");
    assert.equal(store.listSignupRequests().length, 0);

    const session = await store.login("seller@example.com", "SellerPass1234");
    assert.equal(session.identity.role, "owner");
    assert.equal(session.identity.plan, "free");
    assert.ok(session.token.length >= 32);
  });
});

test("rejected signup cannot log in", async () => {
  await withStore(async (store) => {
    const request = await store.requestSignup({ email: "reject@example.com", password: "RejectPass1234" });
    await store.rejectSignup(request.userId);
    await assert.rejects(
      store.login("reject@example.com", "RejectPass1234"),
      /승인되지 않았습니다/
    );
  });
});

test("administrator bootstrap creates username login and never stores plaintext password", async () => {
  await withStore(async (store, path) => {
    const password = "AdminPass90051";
    const identity = await store.bootstrapAdmin({ username: "tnfwod", password });
    assert.equal(identity.username, "tnfwod");
    assert.equal(identity.role, "admin");
    assert.equal(identity.plan, "pro");
    assert.equal(identity.status, "active");

    const session = await store.login("tnfwod", password);
    assert.equal(session.identity.userId, identity.userId);
    assert.equal(session.identity.role, "admin");

    const persisted = await readFile(path, "utf8");
    assert.equal(persisted.includes(password), false);
    assert.match(persisted, /passwordHash/);
  });
});

test("re-running administrator bootstrap with the same password preserves active sessions", async () => {
  await withStore(async (store) => {
    const password = "StableAdmin1234";
    const first = await store.bootstrapAdmin({ username: "tnfwod", password });
    const session = await store.login("tnfwod", password);
    assert.ok(store.authenticate(session.token));

    const second = await store.bootstrapAdmin({ username: "tnfwod", password });
    assert.equal(second.userId, first.userId);
    assert.equal(second.role, "admin");
    assert.ok(store.authenticate(session.token));
  });
});

test("re-running administrator bootstrap rotates password and revokes old sessions", async () => {
  await withStore(async (store) => {
    await store.bootstrapAdmin({ username: "tnfwod", password: "FirstAdmin1234" });
    const oldSession = await store.login("tnfwod", "FirstAdmin1234");
    assert.ok(store.authenticate(oldSession.token));

    await store.bootstrapAdmin({ username: "tnfwod", password: "SecondAdmin1234" });
    assert.equal(store.authenticate(oldSession.token), null);
    await assert.rejects(store.login("tnfwod", "FirstAdmin1234"), /올바르지 않습니다/);
    const next = await store.login("tnfwod", "SecondAdmin1234");
    assert.equal(next.identity.role, "admin");
  });
});

test("login keeps at most five active sessions per account and revokes the oldest", async () => {
  await withStore(async (store, path) => {
    const password = "SessionLimit1234";
    await store.bootstrapAdmin({ username: "tnfwod", password });
    const sessions = [];
    for (let index = 0; index < 6; index += 1) {
      sessions.push(await store.login("tnfwod", password));
    }

    assert.equal(store.authenticate(sessions[0]!.token), null);
    for (const session of sessions.slice(1)) assert.ok(store.authenticate(session.token));

    const persisted = JSON.parse(await readFile(path, "utf8")) as { sessions: Record<string, unknown> };
    assert.equal(Object.keys(persisted.sessions).length, 5);
  });
});

test("account store restores a corrupted primary file from its last known-good backup", async () => {
  await withStore(async (store, path) => {
    const password = "RecoverAdmin1234";
    await store.bootstrapAdmin({ username: "tnfwod", password });
    await store.login("tnfwod", password);

    const backup = await readFile(`${path}.bak`, "utf8");
    assert.equal(backup.includes(password), false);
    assert.match(backup, /passwordHash/);

    await writeFile(path, "{corrupted", "utf8");
    const recovered = await AccountStore.load(path, 7);
    const session = await recovered.login("tnfwod", password);
    assert.equal(session.identity.role, "admin");

    const restoredPrimary = await readFile(path, "utf8");
    assert.doesNotThrow(() => JSON.parse(restoredPrimary));
  });
});

test("account store fails closed when primary data is corrupt and no backup exists", async () => {
  await withStore(async (_store, path) => {
    await writeFile(path, "not-json", "utf8");
    await assert.rejects(AccountStore.load(path, 7));
  });
});
