import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MarketReferenceService } from "../src/markets/marketReferenceService.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-orders-"));
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

test("Coupang order discovery follows v5 nextToken pages and strips buyer/receiver PII", async () => {
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
    const second = token === "NEXT-50";
    return jsonResponse({
      code: 200,
      message: "OK",
      nextToken: second ? null : "NEXT-50",
      data: [{
        shipmentBoxId: second ? 70002 : 70001,
        orderId: second ? 80002 : 80001,
        orderedAt: second ? "2026-09-15T09:00:00+09:00" : "2026-09-15T08:00:00+09:00",
        status: "INSTRUCT",
        orderer: { name: second ? "SECRET-BUYER-2" : "SECRET-BUYER", safeNumber: "010-1111-2222" },
        receiver: { name: "SECRET-RECEIVER", addr1: "SECRET-ADDRESS" },
        orderItems: [{
          sequenceNo: "001",
          productId: second ? 90002 : 90001,
          vendorItemId: second ? 91002 : 91001,
          vendorItemName: "노출 상품명",
          shippingCount: second ? 1 : 2,
          orderPrice: { units: second ? 9900 : 19900 },
          externalVendorSkuCode: second ? "SELLER-SKU-2" : "SELLER-SKU-1",
          sellerProductId: second ? 92002 : 92001,
          sellerProductName: second ? "두 번째 상품" : "SellerHub 테스트 상품",
          sellerProductItemName: second ? "소용량" : "대용량"
        }]
      }]
    });
  }) as typeof fetch;

  const service = new MarketReferenceService(store, fetchMock);
  const result = await service.get("tenant-a", "coupang", "orders", { keyword: "INSTRUCT" }) as {
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasNext: boolean;
    pagesFetched: number;
    effectiveStatus: string | null;
    piiExcluded: boolean;
  };

  assert.equal(calls.length, 2);
  const first = new URL(calls[0]!.url);
  const second = new URL(calls[1]!.url);
  assert.equal(first.pathname, "/v2/providers/openapi/apis/api/v5/vendors/A001/ordersheets");
  assert.equal(first.searchParams.get("status"), "INSTRUCT");
  assert.equal(first.searchParams.get("maxPerPage"), "50");
  assert.equal(first.searchParams.get("nextToken"), null);
  assert.equal(second.searchParams.get("nextToken"), "NEXT-50");
  assert.match(first.searchParams.get("createdAtFrom") ?? "", /^\d{4}-\d{2}-\d{2}\+09:00$/);
  assert.match(first.searchParams.get("createdAtTo") ?? "", /^\d{4}-\d{2}-\d{2}\+09:00$/);
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers["X-Requested-By"], "A001");
  assert.match(headers.Authorization ?? "", /^CEA algorithm=HmacSHA256,/);
  assert.deepEqual(result.items[0], {
    market: "coupang",
    orderId: "80001",
    orderLineId: "70001:001",
    shipmentId: "70001",
    listingId: "92001",
    controlId: "91001",
    productName: "SellerHub 테스트 상품",
    optionName: "대용량",
    quantity: 2,
    price: 19900,
    status: "INSTRUCT",
    orderedAt: "2026-09-15T08:00:00+09:00",
    sellerSku: "SELLER-SKU-1"
  });
  assert.equal(result.items.length, 2);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET-BUYER|SECRET-BUYER-2|SECRET-RECEIVER|SECRET-ADDRESS|010-1111-2222/);
  assert.equal(result.nextCursor, null);
  assert.equal(result.hasNext, false);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.effectiveStatus, "INSTRUCT");
  assert.equal(result.piiExcluded, true);
});

test("Toss order discovery follows orders v2 nextCursor and strips personal fields", async () => {
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
    if (url.startsWith("https://shopping-fep.toss.im/api/v3/shopping-fep/orders/v2")) {
      const cursor = new URL(url).searchParams.get("nextCursor");
      const second = cursor === "CURSOR-2";
      return jsonResponse({
        resultType: "SUCCESS",
        success: {
          results: [{
            orderedAt: second ? "2026-09-15T02:00:00.000Z" : "2026-09-15T01:00:00.000Z",
            orderId: second ? 10002 : 10001,
            orderProductId: second ? 20002 : 20001,
            productId: second ? 30002 : 30001,
            stockId: second ? 40002 : 40001,
            productName: second ? "리클라이너 2" : "리클라이너",
            optionName: second ? "화이트 / S" : "블랙 / L",
            quantity: second ? 1 : 2,
            price: second ? 50000 : 100000,
            orderProductStatus: "PAID",
            productManagementCode: second ? "PROD-002" : "PROD-001",
            productItemManagementCode: second ? "OPT-002" : "OPT-001",
            ordererName: second ? "SECRET-ORDERER-2" : "SECRET-ORDERER",
            receiverName: "SECRET-RECEIVER",
            receiverPhone: "010-9999-8888",
            address: "SECRET-TOSS-ADDRESS"
          }],
          nextCursor: second ? null : "CURSOR-2"
        }
      });
    }
    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const service = new MarketReferenceService(store, fetchMock);
  const result = await service.get("tenant-a", "toss", "orders", { keyword: "PAID" }) as {
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasNext: boolean;
    pagesFetched: number;
    effectiveStatus: string | null;
    piiExcluded: boolean;
  };

  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.url, "https://oauth2.cert.toss.im/token");
  const first = new URL(calls[1]!.url);
  const second = new URL(calls[2]!.url);
  assert.equal(first.pathname, "/api/v3/shopping-fep/orders/v2");
  assert.equal(first.searchParams.get("status"), "PAID");
  assert.equal(first.searchParams.get("limit"), "50");
  assert.equal(first.searchParams.get("partnerName"), "SellerHub");
  assert.equal(first.searchParams.get("nextCursor"), null);
  assert.equal(second.searchParams.get("nextCursor"), "CURSOR-2");
  const headers = calls[1]!.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer TOSS-TOKEN");
  assert.deepEqual(result.items[0], {
    market: "toss",
    orderId: "10001",
    orderLineId: "20001",
    shipmentId: null,
    listingId: "30001",
    controlId: null,
    productName: "리클라이너",
    optionName: "블랙 / L",
    quantity: 2,
    price: 100000,
    status: "PAID",
    orderedAt: "2026-09-15T01:00:00.000Z",
    sellerSku: "OPT-001"
  });
  assert.equal(result.items.length, 2);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SECRET-ORDERER|SECRET-ORDERER-2|SECRET-RECEIVER|SECRET-TOSS-ADDRESS|010-9999-8888/);
  assert.equal(result.nextCursor, null);
  assert.equal(result.hasNext, false);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.effectiveStatus, "PAID");
  assert.equal(result.piiExcluded, true);
});

test("unsupported delegated order markets stay fail-closed without making a provider request", async () => {
  const store = await makeStore();
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return jsonResponse({});
  }) as typeof fetch;
  const service = new MarketReferenceService(store, fetchMock);

  await assert.rejects(() => service.get("tenant-a", "naver", "orders"), /주문 자동수집.*비활성화/);
  await assert.rejects(() => service.get("tenant-a", "kakao", "orders"), /주문 자동수집.*비활성화/);
  assert.equal(called, false);
});
