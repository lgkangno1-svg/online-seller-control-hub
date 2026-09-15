import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApprovalStore } from "../src/core/approvalStore.js";
import type { ParsedCommand } from "../src/core/types.js";

const product = { tenantId: "tenant-a", masterSku: "SKU-1", name: "상품", aliases: [], markets: {} };
const command: ParsedCommand = { action: "SET_OUT_OF_STOCK", productQuery: "상품", markets: ["naver"], value: null };

test("approval token can be consumed only once by the same actor", () => {
  const store = new ApprovalStore(60_000);
  const actor = { kind: "web" as const, id: "tenant-a:tester-1" };
  const pending = store.create({ actor, command, product, snapshot: [] });
  assert.ok(store.consume(pending.id, actor));
  assert.equal(store.consume(pending.id, actor), null);
});

test("another tenant tester cannot consume or invalidate an approval", () => {
  const store = new ApprovalStore(60_000);
  const owner = { kind: "web" as const, id: "tenant-a:tester-1" };
  const pending = store.create({ actor: owner, command, product, snapshot: [] });
  assert.equal(store.consume(pending.id, { kind: "web", id: "tenant-b:tester-2" }), null);
  assert.ok(store.consume(pending.id, owner));
});

test("web actor cannot consume a Telegram actor approval with the same identity text", () => {
  const store = new ApprovalStore(60_000);
  const telegram = { kind: "telegram" as const, id: "tenant-a:123" };
  const pending = store.create({ actor: telegram, command, product, snapshot: [] });
  assert.equal(store.consume(pending.id, { kind: "web", id: "tenant-a:123" }), null);
  assert.ok(store.consume(pending.id, telegram));
});

test("pending approval survives process-style store recreation and remains one-time", () => {
  const dir = mkdtempSync(join(tmpdir(), "sellerhub-approvals-"));
  const path = join(dir, "approvals.json");
  const actor = { kind: "web" as const, id: "tenant-a:tester-1" };
  const first = new ApprovalStore(60_000, path);
  const pending = first.create({ actor, command, product, snapshot: [] });

  const recovered = new ApprovalStore(60_000, path);
  assert.equal(recovered.consume(pending.id, actor)?.id, pending.id);

  const afterConsume = new ApprovalStore(60_000, path);
  assert.equal(afterConsume.consume(pending.id, actor), null);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), []);
});

test("failed persistence cannot consume an approval in memory", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "sellerhub-approvals-failure-"));
  const path = join(dir, "approvals.json");
  const actor = { kind: "web" as const, id: "tenant-a:tester-1" };
  const store = new ApprovalStore(60_000, path);
  const pending = store.create({ actor, command, product, snapshot: [] });

  chmodSync(dir, 0o500);
  try {
    assert.throws(() => store.consume(pending.id, actor), /Failed to persist approvals/);
  } finally {
    chmodSync(dir, 0o700);
  }

  assert.equal(store.consume(pending.id, actor)?.id, pending.id);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), []);
});

test("corrupted approval persistence fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sellerhub-approvals-corrupt-"));
  const path = join(dir, "approvals.json");
  writeFileSync(path, "{not-json", "utf8");
  assert.throws(() => new ApprovalStore(60_000, path), /Approval persistence file is invalid/);
});
