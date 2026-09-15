import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RegistrationLedger } from "../src/persistence/registrationLedger.js";

async function makeLedger() {
  const dir = await mkdtemp(join(tmpdir(), "seller-registration-ledger-"));
  return RegistrationLedger.load(join(dir, "ledger.json"));
}

test("same completed registration key returns cached success instead of a new claim", async () => {
  const ledger = await makeLedger();
  const input = {
    tenantId: "tenant-a",
    market: "naver" as const,
    idempotencyKey: "request-12345678",
    masterSku: "APPLE-1",
    payload: { name: "홍옥", price: 39900 }
  };

  const first = await ledger.claim(input);
  assert.equal(first.kind, "claimed");
  await ledger.finish({
    tenantId: input.tenantId,
    market: input.market,
    idempotencyKey: input.idempotencyKey,
    result: { market: "naver", ok: true, message: "created", externalId: "10001" }
  });

  const retry = await ledger.claim(input);
  assert.equal(retry.kind, "cached");
  if (retry.kind === "cached") assert.equal(retry.result.externalId, "10001");
});

test("same idempotency key cannot be reused for a different payload", async () => {
  const ledger = await makeLedger();
  const common = {
    tenantId: "tenant-a",
    market: "coupang" as const,
    idempotencyKey: "request-abcdefgh",
    masterSku: "MELON-1"
  };

  assert.equal((await ledger.claim({ ...common, payload: { price: 10000 } })).kind, "claimed");
  const conflict = await ledger.claim({ ...common, payload: { price: 20000 } });
  assert.equal(conflict.kind, "conflict");
});

test("idempotency keys are isolated by tenant", async () => {
  const ledger = await makeLedger();
  const base = {
    market: "toss" as const,
    idempotencyKey: "request-shared-key",
    masterSku: "SKU-1",
    payload: { name: "상품" }
  };

  assert.equal((await ledger.claim({ ...base, tenantId: "tenant-a" })).kind, "claimed");
  assert.equal((await ledger.claim({ ...base, tenantId: "tenant-b" })).kind, "claimed");
});

test("failed claim persistence does not publish phantom state and later writes recover", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-registration-ledger-"));
  const path = join(dir, "ledger.json");
  const ledger = await RegistrationLedger.load(path);
  const input = {
    tenantId: "tenant-a",
    market: "toss" as const,
    idempotencyKey: "request-persist-failure",
    masterSku: "SKU-FAIL",
    payload: { name: "상품" }
  };

  await mkdir(path);
  await assert.rejects(() => ledger.claim(input));

  await rm(path, { recursive: true });
  assert.equal((await ledger.claim(input)).kind, "claimed");
});

test("failed finish persistence preserves pending state and can be retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-registration-ledger-"));
  const path = join(dir, "ledger.json");
  const ledger = await RegistrationLedger.load(path);
  const input = {
    tenantId: "tenant-a",
    market: "coupang" as const,
    idempotencyKey: "request-finish-failure",
    masterSku: "SKU-FINISH",
    payload: { name: "상품" }
  };

  assert.equal((await ledger.claim(input)).kind, "claimed");
  await rm(path);
  await mkdir(path);
  const result = { market: "coupang" as const, ok: true, message: "created", externalId: "90001" };
  await assert.rejects(() => ledger.finish({
    tenantId: input.tenantId,
    market: input.market,
    idempotencyKey: input.idempotencyKey,
    result
  }));

  assert.equal((await ledger.claim(input)).kind, "conflict");
  await rm(path, { recursive: true });
  await ledger.finish({ tenantId: input.tenantId, market: input.market, idempotencyKey: input.idempotencyKey, result });
  const retry = await ledger.claim(input);
  assert.equal(retry.kind, "cached");
});

test("concurrent duplicate claims serialize so only one caller can register", async () => {
  const ledger = await makeLedger();
  const input = {
    tenantId: "tenant-a",
    market: "toss" as const,
    idempotencyKey: "request-concurrent-duplicate",
    masterSku: "SKU-DUP",
    payload: { name: "상품", price: 10000 }
  };

  const results = await Promise.all([ledger.claim(input), ledger.claim(input)]);
  assert.deepEqual(results.map((result) => result.kind).sort(), ["claimed", "conflict"]);
});

test("concurrent distinct claims are both preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-registration-ledger-"));
  const path = join(dir, "ledger.json");
  const ledger = await RegistrationLedger.load(path);
  const first = {
    tenantId: "tenant-a",
    market: "coupang" as const,
    idempotencyKey: "request-concurrent-first",
    masterSku: "SKU-1",
    payload: { name: "상품1" }
  };
  const second = {
    tenantId: "tenant-a",
    market: "toss" as const,
    idempotencyKey: "request-concurrent-second",
    masterSku: "SKU-2",
    payload: { name: "상품2" }
  };

  const results = await Promise.all([ledger.claim(first), ledger.claim(second)]);
  assert.equal(results.every((result) => result.kind === "claimed"), true);

  const reloaded = await RegistrationLedger.load(path);
  assert.equal((await reloaded.claim(first)).kind, "conflict");
  assert.equal((await reloaded.claim(second)).kind, "conflict");
});

test("pending registration can recover from a durable catalog mapping after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seller-registration-ledger-"));
  const path = join(dir, "ledger.json");
  const input = {
    tenantId: "tenant-a",
    market: "coupang" as const,
    idempotencyKey: "request-recover-mapped",
    masterSku: "SKU-RECOVER",
    payload: { name: "상품" }
  };
  const first = await RegistrationLedger.load(path);
  assert.equal((await first.claim(input)).kind, "claimed");

  const restarted = await RegistrationLedger.load(path);
  const recovered = await restarted.reconcileMapped((candidate) => {
    assert.equal(candidate.tenantId, "tenant-a");
    assert.equal(candidate.market, "coupang");
    assert.equal(candidate.masterSku, "SKU-RECOVER");
    return { externalId: "SELLER-PRODUCT-1", controlExternalId: "VENDOR-ITEM-1" };
  });
  assert.equal(recovered, 1);

  const retry = await restarted.claim(input);
  assert.equal(retry.kind, "cached");
  if (retry.kind === "cached") {
    assert.equal(retry.result.externalId, "SELLER-PRODUCT-1");
    assert.equal(retry.result.controlExternalId, "VENDOR-ITEM-1");
  }
});

test("pending registration remains fail-closed when no durable mapping can prove success", async () => {
  const ledger = await makeLedger();
  const input = {
    tenantId: "tenant-a",
    market: "toss" as const,
    idempotencyKey: "request-unknown-outcome",
    masterSku: "SKU-UNKNOWN",
    payload: { name: "상품" }
  };
  assert.equal((await ledger.claim(input)).kind, "claimed");
  assert.equal(await ledger.reconcileMapped(() => null), 0);

  const retry = await ledger.claim(input);
  assert.equal(retry.kind, "conflict");
  if (retry.kind === "conflict") assert.match(retry.reason, /결과 확인/);
});
