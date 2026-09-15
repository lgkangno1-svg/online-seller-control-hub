import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BillingStore } from "../src/persistence/billingStore.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "seller-billing-store-"));
  const path = join(dir, "billing.json");
  const store = await BillingStore.load(path);
  return { store, path };
}

test("billing store restores the last-known-good snapshot when primary JSON is corrupted", async () => {
  const { store, path } = await makeStore();
  await store.createOrder({ orderId: "ord_1", tenantId: "tenant-a", userId: "user-a", amount: 29000, proDays: 30 });
  await store.failOrder("ord_1", "first snapshot");
  await store.createOrder({ orderId: "ord_2", tenantId: "tenant-a", userId: "user-a", amount: 29000, proDays: 30 });

  const backup = JSON.parse(await readFile(`${path}.bak`, "utf8")) as { orders: Record<string, { status: string }> };
  assert.equal(backup.orders.ord_1?.status, "FAILED");
  assert.equal(backup.orders.ord_2, undefined);

  await writeFile(path, "{broken-primary", "utf8");
  const recovered = await BillingStore.load(path);
  assert.equal(recovered.getOrder("ord_1")?.status, "FAILED");
  assert.equal(recovered.getOrder("ord_2"), null);

  const restored = JSON.parse(await readFile(path, "utf8")) as { orders: Record<string, { status: string }> };
  assert.equal(restored.orders.ord_1?.status, "FAILED");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("billing store fails closed when primary and backup are both corrupted", async () => {
  const { store, path } = await makeStore();
  await store.createOrder({ orderId: "ord_1", tenantId: "tenant-a", userId: "user-a", amount: 29000, proDays: 30 });
  await store.failOrder("ord_1", "create backup");

  await writeFile(path, "{broken-primary", "utf8");
  await writeFile(`${path}.bak`, "{broken-backup", "utf8");
  await assert.rejects(() => BillingStore.load(path));
});

test("missing billing store starts empty without inventing paid entitlement", async () => {
  const { store } = await makeStore();
  assert.deepEqual(store.entitlement("tenant-a"), { proUntil: null, active: false });
  assert.equal(store.getOrder("missing"), null);
});
