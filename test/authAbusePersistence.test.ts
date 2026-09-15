import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthAbuseGuard } from "../src/web/authAbuseGuard.js";

test("auth abuse limits survive restart without persisting raw identifiers or source IPs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-abuse-"));
  const path = join(dir, "auth-abuse-state.json");
  try {
    const options = {
      loginPerIdentifierLimit: 2,
      loginPerSourceLimit: 2,
      globalLoginFailureLimit: 100,
      now: () => 50_000
    };
    const guard = await AuthAbuseGuard.load(path, options);
    guard.recordLoginFailure("AdminUser@example.com", "cf:203.0.113.77");
    guard.recordLoginFailure("AdminUser@example.com", "cf:203.0.113.77");
    await guard.flushPersistence();

    const raw = await readFile(path, "utf8");
    assert.equal(raw.includes("AdminUser@example.com"), false);
    assert.equal(raw.includes("203.0.113.77"), false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const restarted = await AuthAbuseGuard.load(path, options);
    assert.throws(() => restarted.assertLoginAllowed("adminuser@example.com", "cf:203.0.113.77"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auth abuse state recovers fail-closed from last-known-good backup when primary is damaged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-abuse-recovery-"));
  const path = join(dir, "auth-abuse-state.json");
  try {
    const options = {
      loginPerIdentifierLimit: 2,
      loginPerSourceLimit: 100,
      globalLoginFailureLimit: 100,
      now: () => 100_000
    };
    const guard = await AuthAbuseGuard.load(path, options);
    guard.recordLoginFailure("seller@example.com", "cf:198.51.100.9");
    await guard.flushPersistence();
    guard.recordLoginFailure("seller@example.com", "cf:198.51.100.9");
    await guard.flushPersistence();

    await writeFile(path, "{damaged", "utf8");
    const recovered = await AuthAbuseGuard.load(path, options);
    assert.throws(() => recovered.assertLoginAllowed("seller@example.com", "cf:198.51.100.9"));

    const repaired = await readFile(path, "utf8");
    assert.equal(repaired.includes("seller@example.com"), false);
    assert.equal(repaired.includes("198.51.100.9"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auth abuse state refuses to reset when damaged primary has no valid backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-abuse-corrupt-"));
  const path = join(dir, "auth-abuse-state.json");
  try {
    await writeFile(path, "{damaged", "utf8");
    await assert.rejects(
      AuthAbuseGuard.load(path),
      /auth abuse state is damaged/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
