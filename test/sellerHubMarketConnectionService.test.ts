import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { genSaltSync } from "bcryptjs";
import { SellerHubMarketConnectionService } from "../src/markets/sellerHubMarketConnectionService.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-naver-self-"));
  return EncryptedCredentialStore.create(
    join(dir, "credentials.json"),
    randomBytes(32).toString("base64")
  );
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("SellerHub Naver my-store verification uses SELF without requiring or sending account_id", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "naver", {
    clientId: "client-id",
    clientSecret: genSaltSync(10)
  });

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(init === undefined ? { url: String(input) } : { url: String(input), init });
    if (String(input).endsWith("/external/v1/oauth2/token")) {
      return response({ access_token: "NAVER-SELF-TOKEN", expires_in: 10_800 });
    }
    if (String(input).endsWith("/external/v1/seller/account")) {
      return response({ accountNo: 123 });
    }
    return response({ message: "not found" }, 404);
  }) as typeof fetch;

  const service = new SellerHubMarketConnectionService(store, fetchMock);
  const result = await service.verify("tenant-a", "naver");

  assert.equal(result.ok, true);
  assert.equal(result.registrationSupported, false);
  assert.equal(calls.length, 2);
  const tokenBody = String(calls[0]!.init?.body);
  assert.match(tokenBody, /type=SELF/);
  assert.doesNotMatch(tokenBody, /account_id=/);
  assert.equal(
    (calls[1]!.init?.headers as Record<string, string>).Authorization,
    "Bearer NAVER-SELF-TOKEN"
  );
});

test("SellerHub Naver my-store path fails closed for product registration", async () => {
  const store = await makeStore();
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return response({});
  }) as typeof fetch;
  const service = new SellerHubMarketConnectionService(store, fetchMock);

  const result = await service.registerProduct("tenant-a", "naver", { name: "test" });
  assert.equal(result.ok, false);
  assert.equal(result.externalId, null);
  assert.match(result.message, /정식 다중 판매자 연동/);
  assert.equal(called, false);
});

test("Coupang registration follows sellerProductId with a read-only detail lookup and captures a single vendorItemId", async () => {
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
    if (init?.method === "POST") {
      return response({ code: "SUCCESS", data: { sellerProductId: 12345 } });
    }
    if (url.endsWith("/seller-products/12345")) {
      return response({ code: "SUCCESS", data: { items: [{ vendorItemId: 67890 }] } });
    }
    return response({ message: "not found" }, 404);
  }) as typeof fetch;

  const service = new SellerHubMarketConnectionService(store, fetchMock);
  const result = await service.registerProduct("tenant-a", "coupang", { sellerProductName: "상품" });

  assert.equal(result.ok, true);
  assert.equal(result.externalId, "12345");
  assert.equal(result.controlExternalId, "67890");
  assert.match(result.message, /자동 확인/);
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.url, /seller-products\/12345$/);
  assert.equal(calls[1]!.init?.method, "GET");
  const headers = calls[1]!.init?.headers as Record<string, string>;
  assert.equal(headers["X-Requested-By"], "A001");
  assert.equal(headers["X-MARKET"], "KR");
  assert.match(headers.Authorization ?? "", /^CEA algorithm=HmacSHA256,/);
});

test("Coupang registration never guesses a control id for multi-option products", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "coupang", {
    accessKey: "ACCESS",
    secretKey: "SECRET",
    vendorId: "A001"
  });
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      return response({ code: "SUCCESS", data: { sellerProductId: 55555 } });
    }
    if (String(input).endsWith("/seller-products/55555")) {
      return response({
        code: "SUCCESS",
        data: { items: [{ vendorItemId: 10001 }, { vendorItemId: 10002 }] }
      });
    }
    return response({ message: "not found" }, 404);
  }) as typeof fetch;

  const service = new SellerHubMarketConnectionService(store, fetchMock);
  const result = await service.registerProduct("tenant-a", "coupang", { sellerProductName: "옵션상품" });

  assert.equal(result.ok, true);
  assert.equal(result.externalId, "55555");
  assert.equal(result.controlExternalId ?? null, null);
  assert.match(result.message, /옵션이 2개/);
  assert.match(result.message, /임의 선택하지 않았습니다/);
});
