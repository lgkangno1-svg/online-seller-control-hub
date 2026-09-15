import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";
import { TossMarketAdapter } from "../src/markets/tossAdapter.js";
import type { CatalogProduct } from "../src/catalog/catalog.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-toss-"));
  const store = await EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
  await store.set("tenant-a", "toss", { accessKey: "access", secretKey: "secret" });
  return store;
}

function product(): CatalogProduct {
  return {
    tenantId: "tenant-a",
    masterSku: "APPLE-5KG",
    name: "홍옥 사과 5kg",
    aliases: [],
    markets: { toss: { productId: "12345", externalId: "67890" } }
  };
}

test("Toss adapter reads mapped item state and updates stock", async () => {
  const store = await makeStore();
  let stock = 8;
  let price = 39900;
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/token")) return Response.json({ access_token: "token" });
    if (url.includes("/products/12345/v2")) {
      return Response.json({ resultType: "SUCCESS", success: { id: 12345, exposureStatus: "EXPOSURE" } });
    }
    if (url.includes("/products/12345/product-items")) {
      return Response.json({ resultType: "SUCCESS", success: { items: [{ id: 67890, remainingCount: stock, salePrice: price }] } });
    }
    if (url.includes("/stocks/normal-stock/remaining-count")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { remainingCount: number };
      stock = body.remainingCount;
      return Response.json({ resultType: "SUCCESS", success: {} });
    }
    if (url.endsWith("/sale-price")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { salePrice: number };
      price = body.salePrice;
      return Response.json({ resultType: "SUCCESS", success: {} });
    }
    return new Response("not found", { status: 404 });
  };

  const adapter = new TossMarketAdapter(store, fetchMock as typeof fetch, "https://api.example", "https://oauth.example");
  const before = await adapter.getState(product());
  assert.equal(before.stock, 8);
  assert.equal(before.price, 39900);
  assert.equal(before.saleStatus, "ON_SALE");

  const result = await adapter.execute(product(), {
    action: "SET_STOCK",
    productQuery: "홍옥 사과 5kg",
    markets: ["toss"],
    value: 0
  });
  assert.equal(result.ok, true);
  assert.equal(result.after?.stock, 0);
  assert.equal(result.after?.saleStatus, "OUT_OF_STOCK");
  assert.ok(calls.some((call) => call.url.includes("/product-items/67890/stocks/normal-stock/remaining-count") && call.method === "PUT"));
});

test("Toss adapter updates sale price with product and option IDs", async () => {
  const store = await makeStore();
  let price = 39900;
  const mutationBodies: string[] = [];
  const fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) return Response.json({ access_token: "token" });
    if (url.includes("/products/12345/v2")) return Response.json({ resultType: "SUCCESS", success: { exposureStatus: "EXPOSURE" } });
    if (url.includes("/products/12345/product-items")) return Response.json({ resultType: "SUCCESS", success: { items: [{ id: 67890, remainingCount: 5, salePrice: price }] } });
    if (url.endsWith("/product-items/67890/sale-price")) {
      mutationBodies.push(String(init?.body));
      price = (JSON.parse(String(init?.body)) as { salePrice: number }).salePrice;
      return Response.json({ resultType: "SUCCESS", success: {} });
    }
    return new Response("not found", { status: 404 });
  };

  const adapter = new TossMarketAdapter(store, fetchMock as typeof fetch, "https://api.example", "https://oauth.example");
  const result = await adapter.execute(product(), {
    action: "SET_PRICE",
    productQuery: "홍옥",
    markets: ["toss"],
    value: 37900
  });
  assert.equal(result.after?.price, 37900);
  const body = JSON.parse(mutationBodies[0]!) as Record<string, unknown>;
  assert.equal(body.productId, 12345);
  assert.equal(body.salePrice, 37900);
});
