import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CatalogProduct } from "../src/catalog/catalog.js";
import { CoupangMarketAdapter, coupangSignedDate } from "../src/markets/coupangAdapter.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

const product: CatalogProduct = {
  tenantId: "tenant-a",
  masterSku: "SKU-1",
  name: "테스트 상품",
  aliases: [],
  markets: { coupang: { externalId: "1234567890" } }
};

async function credentialStore() {
  const dir = await mkdtemp(join(tmpdir(), "coupang-adapter-"));
  const store = await EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
  await store.set("tenant-a", "coupang", { accessKey: "ACCESS", secretKey: "SECRET", vendorId: "A0001" });
  return store;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Coupang signed date matches official yyMMddTHHmmssZ shape", () => {
  assert.equal(coupangSignedDate(new Date("2026-09-10T06:30:45.000Z")), "260910T063045Z");
});

test("Coupang adapter reads vendor item inventory state", async () => {
  const store = await credentialStore();
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ code: "SUCCESS", message: "", data: { sellerItemId: 1, amountInStock: 17, salePrice: 39900, onSale: true } });
  }) as typeof fetch;
  const adapter = new CoupangMarketAdapter(store, fetchMock);

  const state = await adapter.getState(product);
  assert.equal(state.stock, 17);
  assert.equal(state.price, 39900);
  assert.equal(state.saleStatus, "ON_SALE");
  assert.match(calls[0]!.url, /vendor-items\/1234567890\/inventories$/);
  assert.match(String((calls[0]!.init?.headers as Record<string, string>).Authorization), /^CEA algorithm=HmacSHA256, access-key=ACCESS,/);
});

test("Coupang adapter changes price without bypassing marketplace price guard", async () => {
  const store = await credentialStore();
  const calls: string[] = [];
  const fetchMock = (async (url: string | URL | Request) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("/prices/")) return jsonResponse({ code: "SUCCESS", message: "가격 변경 완료" });
    const after = calls.some((call) => call.includes("/prices/"));
    return jsonResponse({ code: "SUCCESS", data: { amountInStock: 5, salePrice: after ? 42000 : 39900, onSale: true } });
  }) as typeof fetch;
  const adapter = new CoupangMarketAdapter(store, fetchMock);

  const result = await adapter.execute(product, {
    action: "SET_PRICE",
    productQuery: "테스트 상품",
    markets: ["coupang"],
    value: 42000
  });
  assert.equal(result.ok, true);
  const mutation = calls.find((call) => call.includes("/prices/42000"));
  assert.ok(mutation);
  assert.equal(mutation.includes("forceSalePriceUpdate=true"), false);
  assert.equal(result.before?.price, 39900);
  assert.equal(result.after?.price, 42000);
});

test("Coupang adapter rejects invalid price unit before write", async () => {
  const store = await credentialStore();
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    return jsonResponse({ code: "SUCCESS", data: { amountInStock: 5, salePrice: 39900, onSale: true } });
  }) as typeof fetch;
  const adapter = new CoupangMarketAdapter(store, fetchMock);

  await assert.rejects(
    () => adapter.execute(product, { action: "SET_PRICE", productQuery: "상품", markets: ["coupang"], value: 39999 }),
    /10원 단위/
  );
  assert.equal(calls, 1, "only the read-before-write preflight call should occur");
});

test("Coupang adapter rejects stock above 99,999 before write", async () => {
  const store = await credentialStore();
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    return jsonResponse({ code: "SUCCESS", data: { amountInStock: 5, salePrice: 39900, onSale: true } });
  }) as typeof fetch;
  const adapter = new CoupangMarketAdapter(store, fetchMock);

  await assert.rejects(
    () => adapter.execute(product, { action: "SET_STOCK", productQuery: "상품", markets: ["coupang"], value: 100_000 }),
    /0~99,999/
  );
  assert.equal(calls, 1, "only the read-before-write preflight call should occur");
});
