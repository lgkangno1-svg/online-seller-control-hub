import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "../src/persistence/auditLog.js";

const command = {
  action: "SET_PRICE" as const,
  productQuery: "홍옥",
  markets: ["gmarket" as const],
  value: 39900
};

test("activity history is isolated by tenant and newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-audit-"));
  const log = new AuditLog(join(dir, "audit.jsonl"));

  await log.record({
    actor: { kind: "web", id: "tenant-a:user-1" },
    masterSku: "A-1",
    command,
    results: [{ market: "gmarket", ok: true, message: "ok" }]
  });
  await log.recordRegistration({
    actor: { kind: "web", id: "tenant-b:user-2" },
    masterSku: "B-1",
    market: "naver",
    payload: { name: "other tenant" },
    result: { market: "naver", ok: true, message: "created", externalId: "999", controlExternalId: "999" }
  });
  await log.recordRegistration({
    actor: { kind: "telegram", id: "tenant-a:1234" },
    masterSku: "A-2",
    market: "toss",
    payload: { name: "same tenant" },
    result: { market: "toss", ok: true, message: "created", externalId: "100", controlExternalId: "200" }
  });

  const tenantA = await log.list("tenant-a", 10);
  assert.equal(tenantA.length, 2);
  assert.equal(tenantA[0]?.masterSku, "A-2");
  assert.equal(tenantA[0]?.type, "product_registration");
  assert.equal(tenantA[1]?.masterSku, "A-1");
  assert.equal(tenantA.some((entry) => entry.masterSku === "B-1"), false);
});

test("activity history respects result limits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-audit-limit-"));
  const log = new AuditLog(join(dir, "audit.jsonl"));
  for (let index = 0; index < 5; index++) {
    await log.record({
      actor: { kind: "web", id: "tenant-a:user" },
      masterSku: `SKU-${index}`,
      command,
      results: [{ market: "gmarket", ok: true, message: "ok" }]
    });
  }
  const rows = await log.list("tenant-a", 2);
  assert.deepEqual(rows.map((row) => row.masterSku), ["SKU-4", "SKU-3"]);
});
