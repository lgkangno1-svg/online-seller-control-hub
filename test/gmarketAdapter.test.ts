import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";
import { GmarketMarketAdapter } from "../src/markets/gmarketAdapter.js";
import type { CatalogProduct } from "../src/catalog/catalog.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-gmarket-"));
  const store = await EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
  await store.set("tenant-a", "gmarket", {
    masterId: "master",
    secretKey: "secret",
    gmarketSellerId: "seller",
    issuer: "issuer"
  });
  return store;
}

function product(): CatalogProduct {
  return {
    tenantId: "tenant-a",
    masterSku: "APPLE-5KG",
    name: "홍옥 사과 5kg",
    aliases: [],
    markets: { gmarket: { productId: "2035313538", externalId: "2035313538" } }
  };
}

test("Gmarket price update preserves Auction values exactly", async () => {
  const store = await makeStore();
  let state = {
    gmktSell: true,
    iacSell: false,
    gmktPrice: 39900,
    iacPrice: 41900,
    gmktStock: 12,
    iacStock: 7
  };
  let mutation: Record<string, unknown> | null = null;

  const fetchMock = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "GET") return Response.json(readResponse(state));
    mutation = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const basic = mutation.itemBasicInfo as { price: { gmkt: number }; stock: { gmkt: number } };
    const isSell = mutation.isSell as { gmkt: boolean };
    state = { ...state, gmktSell: isSell.gmkt, gmktPrice: basic.price.gmkt, gmktStock: basic.stock.gmkt };
    return Response.json({ goodsNo: 2035313538, resultCode: 0, message: null });
  };

  const adapter = new GmarketMarketAdapter(store, fetchMock as typeof fetch, "https://esm.example");
  const result = await adapter.execute(product(), {
    action: "SET_PRICE",
    productQuery: "홍옥",
    markets: ["gmarket"],
    value: 37900
  });

  assert.equal(result.after?.price, 37900);
  const payload = mutation as unknown as {
    isSell: { gmkt: boolean; iac: boolean };
    itemBasicInfo: {
      price: { gmkt: number; iac: number };
      stock: { gmkt: number; iac: number };
      sellingPeriod: { gmkt: number; iac: number };
    };
  };
  assert.equal(payload.isSell.iac, false);
  assert.equal(payload.itemBasicInfo.price.iac, 41900);
  assert.equal(payload.itemBasicInfo.stock.iac, 7);
  assert.equal(payload.itemBasicInfo.sellingPeriod.iac, 0);
});

test("Gmarket stock zero converts to sale stop instead of invalid zero stock", async () => {
  const store = await makeStore();
  let state = { gmktSell: true, iacSell: true, gmktPrice: 39900, iacPrice: 39900, gmktStock: 5, iacStock: 9 };
  let mutation: any;
  const fetchMock = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "GET") return Response.json(readResponse(state));
    mutation = JSON.parse(String(init?.body ?? "{}"));
    state = { ...state, gmktSell: mutation.isSell.gmkt, gmktStock: mutation.itemBasicInfo.stock.gmkt };
    return Response.json({ goodsNo: 2035313538, resultCode: 0 });
  };

  const adapter = new GmarketMarketAdapter(store, fetchMock as typeof fetch, "https://esm.example");
  const result = await adapter.execute(product(), {
    action: "SET_STOCK",
    productQuery: "홍옥",
    markets: ["gmarket"],
    value: 0
  });
  assert.equal(mutation.isSell.gmkt, false);
  assert.equal(mutation.itemBasicInfo.stock.gmkt, 5);
  assert.equal(result.after?.saleStatus, "STOPPED");
  assert.match(result.message, /판매중지/);
});

test("Gmarket rejects price changes while stopped and invalid 1-won increments", async () => {
  const store = await makeStore();
  const stopped = { gmktSell: false, iacSell: true, gmktPrice: 39900, iacPrice: 39900, gmktStock: 5, iacStock: 9 };
  const fetchMock = async (): Promise<Response> => Response.json(readResponse(stopped));
  const adapter = new GmarketMarketAdapter(store, fetchMock as typeof fetch, "https://esm.example");

  await assert.rejects(() => adapter.execute(product(), {
    action: "SET_PRICE", productQuery: "홍옥", markets: ["gmarket"], value: 37900
  }), /판매중지/);

  const active = { ...stopped, gmktSell: true };
  const activeFetch = async (): Promise<Response> => Response.json(readResponse(active));
  const activeAdapter = new GmarketMarketAdapter(store, activeFetch as typeof fetch, "https://esm.example");
  await assert.rejects(() => activeAdapter.execute(product(), {
    action: "SET_PRICE", productQuery: "홍옥", markets: ["gmarket"], value: 37901
  }), /10원 단위/);
});

function readResponse(state: {
  gmktSell: boolean; iacSell: boolean; gmktPrice: number; iacPrice: number; gmktStock: number; iacStock: number;
}) {
  return {
    IsSell: { gmkt: state.gmktSell, iac: state.iacSell },
    itemBasicInfo: {
      Price: { gmkt: state.gmktPrice, iac: state.iacPrice },
      Stock: { gmkt: state.gmktStock, iac: state.iacStock },
      SellingPeriod: { gmkt: 20991231, iac: 20991231 }
    }
  };
}
