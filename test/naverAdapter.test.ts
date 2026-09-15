import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { genSaltSync } from "bcryptjs";
import type { CatalogProduct } from "../src/catalog/catalog.js";
import { NaverMarketAdapter } from "../src/markets/naverAdapter.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

const product: CatalogProduct = {
  tenantId: "naver-test-tenant",
  masterSku: "NAVER-SKU-1",
  name: "네이버 테스트 상품",
  aliases: [],
  markets: { naver: { productId: "123456789" } }
};

async function credentialStore() {
  const dir = await mkdtemp(join(tmpdir(), "naver-adapter-"));
  const store = await EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
  await store.set(product.tenantId, "naver", {
    clientId: `client-${Math.random()}`,
    clientSecret: genSaltSync(4),
    accountId: "seller-uid"
  });
  return store;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Naver adapter sets base product stock to OUTOFSTOCK with stockQuantity 0", async () => {
  const store = await credentialStore();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let changed = false;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(init ? { url, init } : { url });
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "NAVER-ADAPTER-TOKEN", expires_in: 10800 });
    if (url.includes("/change-status")) {
      changed = true;
      return jsonResponse({});
    }
    if (url.includes("/v2/products/origin-products/123456789")) {
      return jsonResponse({
        originProduct: {
          statusType: changed ? "OUTOFSTOCK" : "SALE",
          salePrice: 39900,
          stockQuantity: changed ? 0 : 10,
          detailAttribute: { optionInfo: { useStockManagement: false } }
        }
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  }) as typeof fetch;

  const adapter = new NaverMarketAdapter(store, fetchMock);
  const result = await adapter.execute(product, {
    action: "SET_OUT_OF_STOCK",
    productQuery: product.name,
    markets: ["naver"],
    value: null
  });

  assert.equal(result.ok, true);
  assert.equal(result.before?.stock, 10);
  assert.equal(result.after?.stock, 0);
  assert.equal(result.after?.saleStatus, "OUT_OF_STOCK");
  const mutation = calls.find((call) => call.url.includes("/change-status"));
  assert.ok(mutation);
  assert.deepEqual(JSON.parse(String(mutation.init?.body)), { statusType: "OUTOFSTOCK", stockQuantity: 0 });
});

test("Naver adapter blocks root stock writes for current optionCombinations schema", async () => {
  const store = await credentialStore();
  const calls: string[] = [];
  const fetchMock = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "NAVER-OPTION-TOKEN", expires_in: 10800 });
    return jsonResponse({
      originProduct: {
        statusType: "SALE",
        salePrice: 39900,
        stockQuantity: 9999,
        detailAttribute: {
          optionInfo: {
            useStockManagement: true,
            optionCombinations: [{ id: 11, optionName1: "5kg", stockQuantity: 7 }]
          }
        }
      }
    });
  }) as typeof fetch;

  const adapter = new NaverMarketAdapter(store, fetchMock);
  await assert.rejects(
    () => adapter.execute(product, {
      action: "SET_STOCK",
      productQuery: product.name,
      markets: ["naver"],
      value: 4
    }),
    /옵션별 재고관리 상품/
  );
  assert.equal(calls.some((url) => url.includes("/change-status")), false, "option-managed stock must never fall through to root stock write");
});

test("Naver adapter blocks automatic resume for option-managed products", async () => {
  const store = await credentialStore();
  const calls: string[] = [];
  const fetchMock = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "NAVER-RESUME-TOKEN", expires_in: 10800 });
    return jsonResponse({
      originProduct: {
        statusType: "SUSPENSION",
        salePrice: 39900,
        stockQuantity: 9999,
        detailAttribute: {
          optionInfo: {
            useStockManagement: true,
            optionCombinations: [{ id: 11, optionName1: "5kg", stockQuantity: 0 }]
          }
        }
      }
    });
  }) as typeof fetch;

  const adapter = new NaverMarketAdapter(store, fetchMock);
  await assert.rejects(
    () => adapter.execute(product, {
      action: "RESUME_SALES",
      productQuery: product.name,
      markets: ["naver"],
      value: null
    }),
    /자동 판매재개를 차단/
  );
  assert.equal(calls.some((url) => url.includes("/change-status")), false, "option-managed resume must never write without option-level stock verification");
});

test("Naver adapter uses SALE_PRICE TO WON bulk update for absolute price", async () => {
  const store = await credentialStore();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let changed = false;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(init ? { url, init } : { url });
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "NAVER-PRICE-TOKEN", expires_in: 10800 });
    if (url.endsWith("/v1/products/origin-products/bulk-update")) {
      changed = true;
      return jsonResponse({});
    }
    return jsonResponse({
      originProduct: {
        statusType: "SALE",
        salePrice: changed ? 42900 : 39900,
        stockQuantity: 8,
        detailAttribute: { optionInfo: { useStockManagement: false } }
      }
    });
  }) as typeof fetch;

  const adapter = new NaverMarketAdapter(store, fetchMock);
  const result = await adapter.execute(product, {
    action: "SET_PRICE",
    productQuery: product.name,
    markets: ["naver"],
    value: 42900
  });
  assert.equal(result.after?.price, 42900);
  const mutation = calls.find((call) => call.url.endsWith("/v1/products/origin-products/bulk-update"));
  assert.ok(mutation);
  assert.deepEqual(JSON.parse(String(mutation.init?.body)), {
    originProductNos: [123456789],
    productBulkUpdateType: "SALE_PRICE",
    productSalePrice: {
      value: 42900,
      productSalePriceChangerType: "TO",
      productSalePriceChangerUnitType: "WON"
    }
  });
});
