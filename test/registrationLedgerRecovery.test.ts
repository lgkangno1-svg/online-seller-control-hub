import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistrationLedger } from "../src/persistence/registrationLedger.js";

async function makeLedger() {
  const dir = await mkdtemp(join(tmpdir(), "seller-registration-ledger-"));
  const path = join(dir, "registration-ledger.json");
  return { ledger: await RegistrationLedger.load(path), path };
}

const successResult = {
  market: "naver" as const,
  ok: true,
  message: "registered",
  externalId: "product-1",
  controlExternalId: "control-1"
};

test("registration ledger restores last-known-good idempotency data after primary corruption", async () => {
  const { ledger, path } = await makeLedger();
  await ledger.claim({ tenantId: "tenant-a", market: "naver", idempotencyKey: "idem-key-0001", masterSku: "SKU-1", payload: { name: "one" } });
  await ledger.finish({ tenantId: "tenant-a", market: "naver", idempotencyKey: "idem-key-0001", result: successResult });
  await ledger.claim({ tenantId: "tenant-a", market: "naver", idempotencyKey: "idem-key-0002", masterSku: "SKU-2", payload: { name: "two" } });

  const backup = JSON.parse(await readFile(`${path}.bak`, "utf8")) as Array<{ idempotencyKey: string; status: string }>;
  assert.equal(backup.find((row) => row.idempotencyKey === "idem-key-0001")?.status, "COMPLETED");
  assert.equal(backup.some((row) => row.idempotencyKey === "idem-key-0002"), false);

  await writeFile(path, "{broken-primary", "utf8");
  const recovered = await RegistrationLedger.load(path);
  const claim = await recovered.claim({ tenantId: "tenant-a", market: "naver", idempotencyKey: "idem-key-0001", masterSku: "SKU-1", payload: { name: "one" } });
  assert.equal(claim.kind, "cached");
  if (claim.kind === "cached") assert.equal(claim.result.externalId, "product-1");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("registration ledger fails closed when both primary and backup are corrupted", async () => {
  const { ledger, path } = await makeLedger();
  await ledger.claim({ tenantId: "tenant-a", market: "naver", idempotencyKey: "idem-key-0001", masterSku: "SKU-1", payload: { name: "one" } });
  await ledger.finish({ tenantId: "tenant-a", market: "naver", idempotencyKey: "idem-key-0001", result: successResult });
  await writeFile(path, "{broken-primary", "utf8");
  await writeFile(`${path}.bak`, "{broken-backup", "utf8");

  await assert.rejects(() => RegistrationLedger.load(path));
});
