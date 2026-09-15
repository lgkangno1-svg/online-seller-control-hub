import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MarketReferenceService } from "../src/markets/marketReferenceService.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-market-reference-"));
  return EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    randomBytes(32).toString("base64")
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("Coupang product discovery follows nextToken, deduplicates candidates, and never guesses vendorItemId", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "coupang", {
    accessKey: "ACCESS",
    secretKey: "SECRET",
    vendorId: "A001"
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(init === undefined ? { url } : { url, init });
    const token = new URL(url).searchParams.get("nextToken");
    if (!token) {
      return jsonResponse({
        code: "SUCCESS",
        message: "",
        nextToken: "2",
        data: [{
          sellerProductId: 239092172,
          sellerProductName: "테스트 상품",
          productId: 14784194,
          categoryId: 2102,
          brand: "테스트브랜드",
          statusName: "승인완료",
          createdAt: "2026-09-14T10:00:00"
        }]
      });
    }
    assert.equal(token, "2");
    return jsonResponse({
      code: "SUCCESS",
      message: "",
      nextToken: null,
      data: [{
        sellerProductId: 239092173,
        sellerProductName: "두 번째 상품",
        productId: 14784195,
        categoryId: 2102,
        brand: "테스트브랜드",
        statusName: "승인완료",
        createdAt: "2026-09-14T11:00:00"
      }]
    });
  }) as typeof fetch;

  const service = new MarketReferenceService(store, fetchMock);
  const result = await service.get("tenant-a", "coupang", "products") as {
    items: Array<Record<string, unknown>>;
    nextToken: string | null;
    hasNext: boolean;
    pagesFetched: number;
    controlMappingNote: string;
  };

  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /seller-products\?vendorId=A001&maxPerPage=100$/);
  assert.equal(new URL(calls[1]!.url).searchParams.get("nextToken"), "2");
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["X-Requested-By"], "A001");
  assert.match(headers.Authorization ?? "", /^CEA algorithm=HmacSHA256,/);
  assert.deepEqual(result.items[0], {
    market: "coupang",
    productId: "239092172",
    providerProductId: "14784194",
    name: "테스트 상품",
    brand: "테스트브랜드",
    categoryId: "2102",
    status: "승인완료",
    price: null,
    registeredAt: "2026-09-14T10:00:00",
    controlMappingReady: false
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.nextToken, null);
  assert.equal(result.hasNext, false);
  assert.equal(result.pagesFetched, 2);
  assert.match(result.controlMappingNote, /vendorItemId/);
});

test("Toss product discovery obtains one OAuth token and follows official nextToken pagination", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "toss", {
    accessKey: "ACCESS",
    secretKey: "SECRET"
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(init === undefined ? { url } : { url, init });
    if (url === "https://oauth2.cert.toss.im/token") {
      return jsonResponse({ access_token: "TOSS-TOKEN", expires_in: 3600 });
    }
    if (url.startsWith("https://shopping-fep.toss.im/api/v3/shopping-fep/products/v2")) {
      const token = new URL(url).searchParams.get("nextToken");
      return jsonResponse({
        resultType: "SUCCESS",
        success: {
          products: [{
            id: token ? 12346 : 12345,
            name: token ? "리클라이너 2" : "리클라이너",
            brandName: "토스",
            salePrice: token ? 90000 : 80000,
            inspectionStatus: "COMPLETE",
            exposureStatus: "EXPOSURE",
            regTs: "2026-03-12T00:04:23.380Z"
          }],
          nextToken: token ? null : "NEXT",
          hasNext: !token
        }
      });
    }
    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const service = new MarketReferenceService(store, fetchMock);
  const result = await service.get("tenant-a", "toss", "products") as {
    items: Array<Record<string, unknown>>;
    nextToken: string | null;
    hasNext: boolean;
    pagesFetched: number;
    controlMappingNote: string;
  };

  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.url, "https://oauth2.cert.toss.im/token");
  assert.match(calls[1]!.url, /products\/v2\?size=50&partnerName=SellerHub$/);
  assert.equal(new URL(calls[2]!.url).searchParams.get("nextToken"), "NEXT");
  const headers = calls[1]!.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer TOSS-TOKEN");
  assert.deepEqual(result.items[0], {
    market: "toss",
    productId: "12345",
    providerProductId: null,
    name: "리클라이너",
    brand: "토스",
    categoryId: null,
    status: "EXPOSURE",
    price: 80000,
    registeredAt: "2026-03-12T00:04:23.380Z",
    controlMappingReady: false
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.nextToken, null);
  assert.equal(result.hasNext, false);
  assert.equal(result.pagesFetched, 2);
  assert.match(result.controlMappingNote, /product-items/);
});

test("product discovery rejects a repeated provider cursor instead of looping forever", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "coupang", {
    accessKey: "ACCESS",
    secretKey: "SECRET",
    vendorId: "A001"
  });
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    return jsonResponse({
      code: "SUCCESS",
      nextToken: "SAME",
      data: [{ sellerProductId: calls, sellerProductName: `상품 ${calls}` }]
    });
  }) as typeof fetch;
  const service = new MarketReferenceService(store, fetchMock);

  await assert.rejects(
    () => service.get("tenant-a", "coupang", "products"),
    /페이지 커서가 반복되어 자동 수집을 중단/
  );
  assert.equal(calls, 2);
});

test("Naver delegated product discovery stays fail-closed until accountUid product lookup semantics are verified", async () => {
  const store = await makeStore();
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return jsonResponse({});
  }) as typeof fetch;
  const service = new MarketReferenceService(store, fetchMock);

  await assert.rejects(
    () => service.get("tenant-a", "naver", "products"),
    /accountUid 기반 조회가 검증되기 전까지 비활성화/
  );
  assert.equal(called, false);
});
