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
  tenantId: "naver-trace-test",
  masterSku: "NAVER-TRACE-1",
  name: "trace test",
  aliases: [],
  markets: { naver: { productId: "123456789" } }
};

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "naver-trace-"));
  const credentials = await EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
  await credentials.set(product.tenantId, "naver", {
    clientId: `client-${Math.random()}`,
    clientSecret: genSaltSync(4),
    accountId: "seller-uid"
  });
  return credentials;
}

test("Naver adapter preserves gateway Trace ID on product API failures", async () => {
  const credentials = await store();
  const fetchMock = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "TRACE-TOKEN", expires_in: 10800 }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "invalid origin product" }), {
      status: 400,
      headers: { "GNCP-GW-Trace-ID": "trace-product-123" }
    });
  }) as typeof fetch;

  const adapter = new NaverMarketAdapter(credentials, fetchMock);
  await assert.rejects(() => adapter.getState(product), /invalid origin product \(Trace ID: trace-product-123\)/);
});

test("Naver adapter preserves body Trace ID on OAuth failures", async () => {
  const credentials = await store();
  const fetchMock = (async () => new Response(JSON.stringify({ code: "INVALID_CLIENT", traceId: "trace-oauth-456" }), { status: 401 })) as typeof fetch;
  const adapter = new NaverMarketAdapter(credentials, fetchMock);
  await assert.rejects(() => adapter.getState(product), /INVALID_CLIENT \(Trace ID: trace-oauth-456\)/);
});
