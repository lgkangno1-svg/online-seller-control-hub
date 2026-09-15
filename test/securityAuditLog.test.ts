import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SecurityAuditLog } from "../src/persistence/securityAuditLog.js";

test("security audit log fingerprints identifiers and request sources", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sellerhub-security-audit-"));
  const file = path.join(dir, "security.jsonl");
  try {
    const log = new SecurityAuditLog(file);
    await log.record({
      type: "login_failure",
      identifier: "Seller@Example.com",
      sourceKey: "cf:203.0.113.99"
    });

    const raw = await readFile(file, "utf8");
    assert.doesNotMatch(raw, /seller@example\.com/i);
    assert.doesNotMatch(raw, /203\.0\.113\.99/);
    const event = JSON.parse(raw.trim()) as Record<string, unknown>;
    assert.equal(event.type, "login_failure");
    assert.match(String(event.identifierHash), /^[a-f0-9]{64}$/);
    assert.match(String(event.sourceHash), /^[a-f0-9]{64}$/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("security audit log rotates bounded history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sellerhub-security-rotate-"));
  const file = path.join(dir, "security.jsonl");
  try {
    const log = new SecurityAuditLog(file, 1_024);
    for (let index = 0; index < 30; index += 1) {
      await log.record({
        type: "login_failure",
        identifier: `seller-${index}@example.com`,
        sourceKey: `cf:192.0.2.${index}`
      });
    }

    const rotated = await readFile(`${file}.1`, "utf8");
    assert.ok(rotated.length >= 1_024);
    assert.ok((await stat(file)).size < 1_500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("security audit recent reads newest events across rotation without exposing raw identifiers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sellerhub-security-recent-"));
  const file = path.join(dir, "security.jsonl");
  try {
    const log = new SecurityAuditLog(file, 1_024);
    for (let index = 0; index < 24; index += 1) {
      await log.record({
        type: index % 2 === 0 ? "login_failure" : "signup_requested",
        identifier: `person-${index}@example.com`,
        sourceKey: `cf:198.51.100.${index}`
      });
    }

    const events = await log.recent(7);
    assert.equal(events.length, 7);
    assert.ok(Date.parse(events[0]!.at) >= Date.parse(events[6]!.at));
    for (const event of events) {
      assert.match(event.identifierHash ?? "", /^[a-f0-9]{64}$/);
      assert.match(event.sourceHash ?? "", /^[a-f0-9]{64}$/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("security audit recent ignores malformed trailing records and validates limits", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sellerhub-security-malformed-"));
  const file = path.join(dir, "security.jsonl");
  try {
    const log = new SecurityAuditLog(file);
    await log.record({ type: "login_success", identifier: "admin" });
    await appendFile(file, "{truncated-json\n", "utf8");
    await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), type: "unknown_event" })}\n`, "utf8");

    const events = await log.recent(10);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "login_success");
    await assert.rejects(() => log.recent(0), /between 1 and 500/);
    await assert.rejects(() => log.recent(501), /between 1 and 500/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
