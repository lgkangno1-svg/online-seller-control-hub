import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CACHED_ORDER_REFERENCE } from "../src/markets/orderCacheMarker.js";
import { PersistingMarketReferenceService } from "../src/markets/persistingMarketReferenceService.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";
import { OrderSnapshotStore, type OrderSnapshotInput } from "../src/persistence/orderSnapshotStore.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function cachedOrder(overrides: Partial<OrderSnapshotInput> = {}): OrderSnapshotInput {
  return {
    market: "coupang",
    orderId: "ORDER-1",
    orderLineId: "LINE-1",
    shipmentId: "SHIP-1",
    listingId: "PRODUCT-1",
    controlId: "ITEM-1",
    productName: "저장된 테스트 상품",
    optionName: "옵션",
    quantity: 1,
    price: 12000,
    status: "ACCEPT",
    orderedAt: "2026-09-15T08:00:00+09:00",
    sellerSku: "SKU-1",
    ...overrides
  };
}

test("successful normalized order discovery is persisted and survives restart without PII", async () => {
  const dir = await mkdtemp(join(tmpdir(), "persisting-orders-"));
  const credentials = await EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    randomBytes(32).toString("base64")
  );
  const snapshotsPath = join(dir, "order-snapshots.json");
  const snapshots = await OrderSnapshotStore.load(snapshotsPath);
  await credentials.set("tenant-a", "coupang", { accessKey: "ACCESS", secretKey: "SECRET", vendorId: "A001" });

  const fetchMock = (async () => response({
    code: 200,
    nextToken: null,
    data: [{
      shipmentBoxId: 70001,
      orderId: 80001,
      orderedAt: "2026-09-15T08:00:00+09:00",
      status: "ACCEPT",
      orderer: { name: "PII-BUYER", safeNumber: "010-1111-2222" },
      receiver: { name: "PII-RECEIVER", addr1: "PII-ADDRESS" },
      orderItems: [{
        sequenceNo: "1",
        vendorItemId: 91001,
        sellerProductId: 92001,
        sellerProductName: "테스트 상품",
        sellerProductItemName: "옵션",
        shippingCount: 1,
        orderPrice: { units: 12000 },
        externalVendorSkuCode: "SKU-1"
      }]
    }]
  })) as typeof fetch;

  const service = new PersistingMarketReferenceService(credentials, snapshots, fetchMock);
  await service.get("tenant-a", "coupang", "orders", { keyword: "ACCEPT" });

  assert.equal(snapshots.count("tenant-a"), 1);
  const stored = snapshots.list("tenant-a")[0]!;
  assert.equal(stored.orderLineId, "70001:1");
  assert.equal(stored.productName, "테스트 상품");
  assert.doesNotMatch(JSON.stringify(stored), /PII-BUYER|PII-RECEIVER|PII-ADDRESS|010-1111-2222/);

  const restarted = await OrderSnapshotStore.load(snapshotsPath);
  assert.equal(restarted.count("tenant-a"), 1);
  assert.equal(restarted.list("tenant-a")[0]!.sellerSku, "SKU-1");
});

test("explicit cached order reads are tenant and market isolated and never call marketplace providers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cached-orders-"));
  const credentials = await EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    randomBytes(32).toString("base64")
  );
  const snapshots = await OrderSnapshotStore.load(join(dir, "order-snapshots.json"));
  await snapshots.merge("tenant-a", [cachedOrder()]);
  await snapshots.merge("tenant-a", [cachedOrder({ market: "toss", orderLineId: "TOSS-LINE", orderId: "TOSS-ORDER" })]);
  await snapshots.merge("tenant-b", [cachedOrder({ orderLineId: "OTHER-TENANT", orderId: "OTHER-ORDER" })]);

  let providerCalls = 0;
  const fetchMock = (async () => {
    providerCalls += 1;
    throw new Error("provider must not be called for cached order reads");
  }) as typeof fetch;

  const service = new PersistingMarketReferenceService(credentials, snapshots, fetchMock);
  const result = await service.get("tenant-a", "coupang", "orders", { keyword: CACHED_ORDER_REFERENCE }) as {
    items: Array<Record<string, unknown>>;
    pagesFetched: number;
    effectiveStatus: string | null;
    piiExcluded: boolean;
  };

  assert.equal(providerCalls, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.orderId, "ORDER-1");
  assert.equal(result.pagesFetched, 0);
  assert.equal(result.effectiveStatus, CACHED_ORDER_REFERENCE);
  assert.equal(result.piiExcluded, true);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /tenant-a|tenant-b|firstSeenAt|lastSeenAt|OTHER-ORDER|TOSS-ORDER/);
});
