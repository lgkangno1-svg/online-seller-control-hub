import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OrderSnapshotStore, type OrderSnapshotInput } from "../src/persistence/orderSnapshotStore.js";

function order(overrides: Partial<OrderSnapshotInput> = {}): OrderSnapshotInput {
  return {
    market: "coupang",
    orderId: "ORDER-1",
    orderLineId: "LINE-1",
    shipmentId: "SHIP-1",
    listingId: "PRODUCT-1",
    controlId: "ITEM-1",
    productName: "테스트 상품",
    optionName: "대용량",
    quantity: 2,
    price: 19900,
    status: "ACCEPT",
    orderedAt: "2026-09-15T08:00:00+09:00",
    sellerSku: "SKU-1",
    ...overrides
  };
}

test("order snapshots persist across restart and update the same market order line idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "order-snapshot-"));
  const path = join(dir, "orders.json");
  const store = await OrderSnapshotStore.load(path);

  const first = await store.merge("tenant-a", [order()]);
  assert.deepEqual(first, { inserted: 1, updated: 0, total: 1 });
  const firstSeenAt = store.list("tenant-a")[0]!.firstSeenAt;

  const second = await store.merge("tenant-a", [order({ status: "INSTRUCT", quantity: 3 })]);
  assert.deepEqual(second, { inserted: 0, updated: 1, total: 1 });
  const current = store.list("tenant-a")[0]!;
  assert.equal(current.status, "INSTRUCT");
  assert.equal(current.quantity, 3);
  assert.equal(current.firstSeenAt, firstSeenAt);

  const restarted = await OrderSnapshotStore.load(path);
  assert.equal(restarted.count("tenant-a"), 1);
  assert.equal(restarted.list("tenant-a")[0]!.status, "INSTRUCT");
});

test("order snapshots isolate tenants and markets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "order-snapshot-"));
  const path = join(dir, "orders.json");
  const store = await OrderSnapshotStore.load(path);

  await store.merge("tenant-a", [order()]);
  await store.merge("tenant-b", [order({ market: "toss", orderLineId: "TOSS-LINE", controlId: null })]);

  assert.equal(store.list("tenant-a").length, 1);
  assert.equal(store.list("tenant-b").length, 1);
  assert.equal(store.list("tenant-a", { market: "toss" }).length, 0);
  assert.equal(store.list("tenant-b", { market: "toss" })[0]!.orderLineId, "TOSS-LINE");
});

test("order snapshots reject unexpected fields so PII cannot be accidentally persisted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "order-snapshot-"));
  const path = join(dir, "orders.json");
  const store = await OrderSnapshotStore.load(path);
  const unsafe = { ...order(), receiverName: "DO-NOT-PERSIST", address: "SECRET-ADDRESS" };

  await assert.rejects(() => store.merge("tenant-a", [unsafe as OrderSnapshotInput]), /Unrecognized key/);
  assert.equal(store.count("tenant-a"), 0);
  await assert.rejects(() => readFile(path, "utf8"), { code: "ENOENT" });
});

test("order snapshot loader restores a valid backup when the primary file becomes corrupt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "order-snapshot-"));
  const path = join(dir, "orders.json");
  const store = await OrderSnapshotStore.load(path);
  await store.merge("tenant-a", [order()]);
  await store.merge("tenant-a", [order({ orderLineId: "LINE-2", orderId: "ORDER-2" })]);

  await writeFile(path, "{broken-json", "utf8");
  const recovered = await OrderSnapshotStore.load(path);
  assert.equal(recovered.count("tenant-a"), 1);
  assert.equal(recovered.list("tenant-a")[0]!.orderLineId, "LINE-1");
  const repaired = JSON.parse(await readFile(path, "utf8")) as unknown[];
  assert.equal(repaired.length, 1);
});

test("order snapshot loader fails closed when primary is corrupt and no valid backup exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "order-snapshot-"));
  const path = join(dir, "orders.json");
  await writeFile(path, "{broken-json", "utf8");
  await rm(`${path}.bak`, { force: true });

  await assert.rejects(() => OrderSnapshotStore.load(path));
});
