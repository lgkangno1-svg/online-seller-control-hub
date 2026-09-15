import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersistingMarketReferenceService } from "../src/markets/persistingMarketReferenceService.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";
import { OrderSnapshotStore } from "../src/persistence/orderSnapshotStore.js";

test("Coupang category reference uses official prediction API when a product name is supplied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coupang-category-predict-"));
  const credentials = await EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    randomBytes(32).toString("base64")
  );
  await credentials.set("tenant-a", "coupang", {
    accessKey: "ACCESS-KEY",
    secretKey: "SECRET-KEY",
    vendorId: "A00123456"
  });
  const snapshots = await OrderSnapshotStore.load(join(dir, "orders.json"));

  let called = 0;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    called += 1;
    assert.equal(String(input), "https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v1/categorization/predict");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.match(headers.get("authorization") ?? "", /^CEA algorithm=HmacSHA256, access-key=ACCESS-KEY,/);
    assert.equal(headers.get("x-requested-by"), "A00123456");
    assert.equal(headers.get("x-market"), "KR");
    assert.deepEqual(JSON.parse(String(init?.body)), { productName: "홍옥 사과 5kg 선물세트" });
    return new Response(JSON.stringify({
      code: 200,
      message: "OK",
      data: {
        autoCategorizationPredictionResultType: "SUCCESS",
        predictedCategoryId: "12345",
        predictedCategoryName: "사과",
        comment: null
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const service = new PersistingMarketReferenceService(credentials, snapshots, fetchMock);
  const result = await service.get("tenant-a", "coupang", "categories", { keyword: "홍옥 사과 5kg 선물세트" }) as {
    data: { predictedCategoryId: string; predictedCategoryName: string };
  };

  assert.equal(called, 1);
  assert.equal(result.data.predictedCategoryId, "12345");
  assert.equal(result.data.predictedCategoryName, "사과");
});

test("Coupang category reference without a keyword keeps the existing category-list behavior", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coupang-category-list-"));
  const credentials = await EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    randomBytes(32).toString("base64")
  );
  await credentials.set("tenant-a", "coupang", {
    accessKey: "ACCESS-KEY",
    secretKey: "SECRET-KEY",
    vendorId: "A00123456"
  });
  const snapshots = await OrderSnapshotStore.load(join(dir, "orders.json"));

  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), /\/marketplace\/meta\/display-categories$/);
    assert.ok(init?.method === undefined || init.method === "GET");
    return new Response(JSON.stringify({ code: "SUCCESS", data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  const service = new PersistingMarketReferenceService(credentials, snapshots, fetchMock);
  const result = await service.get("tenant-a", "coupang", "categories") as Record<string, unknown>;
  assert.deepEqual(result, { code: "SUCCESS", data: [] });
});
