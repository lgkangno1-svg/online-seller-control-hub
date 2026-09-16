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
  tenantId: "naver-single-flight-tenant",
  masterSku: "NAVER-SINGLE-FLIGHT",
  name: "네이버 OAuth 동시성 테스트",
  aliases: [],
  markets: { naver: { productId: "123456789" } }
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("Naver adapter coalesces concurrent OAuth requests for the same tenant credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "naver-single-flight-"));
  const store = await EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
  await store.set(product.tenantId, "naver", {
    clientId: `client-${Math.random()}`,
    clientSecret: genSaltSync(4),
    accountId: "seller-uid"
  });

  let oauthCalls = 0;
  const fetchMock = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      oauthCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({ access_token: "SINGLE-FLIGHT-TOKEN", expires_in: 10800 });
    }
    return jsonResponse({
      originProduct: {
        statusType: "SALE",
        salePrice: 39900,
        stockQuantity: 7,
        detailAttribute: { optionInfo: { useStockManagement: false } }
      }
    });
  }) as typeof fetch;

  const adapter = new NaverMarketAdapter(store, fetchMock);
  const [first, second] = await Promise.all([adapter.getState(product), adapter.getState(product)]);

  assert.equal(first.stock, 7);
  assert.equal(second.stock, 7);
  assert.equal(oauthCalls, 1, "concurrent adapter reads must share one OAuth request");
});
