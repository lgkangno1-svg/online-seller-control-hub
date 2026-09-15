import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { genSaltSync } from "bcryptjs";
import { MarketConnectionService } from "../src/markets/marketConnectionService.js";
import { EncryptedCredentialStore } from "../src/persistence/credentialStore.js";

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "market-connections-"));
  return EncryptedCredentialStore.create(join(dir, "credentials.json"), randomBytes(32).toString("base64"));
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("Naver verification requires both OAuth token and seller account API access", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "naver", {
    clientId: "client-id",
    clientSecret: genSaltSync(10),
    accountId: "seller-uid"
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const item = init === undefined ? { url: String(input) } : { url: String(input), init };
    calls.push(item);
    if (String(input).endsWith("/external/v1/oauth2/token")) return response({ access_token: "NAVER-TOKEN", expires_in: 10800 });
    if (String(input).endsWith("/external/v1/seller/account")) return response({ accountNo: 123 });
    return response({ message: "not found" }, 404);
  }) as typeof fetch;

  const service = new MarketConnectionService(store, fetchMock);
  const result = await service.verify("tenant-a", "naver");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]!.init?.body), /type=SELLER/);
  assert.match(String(calls[0]!.init?.body), /account_id=seller-uid/);
  assert.equal((calls[1]!.init?.headers as Record<string, string>).Authorization, "Bearer NAVER-TOKEN");
});

test("Coupang verification signs a seller-product read with required marketplace headers", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "coupang", { accessKey: "ACCESS", secretKey: "SECRET", vendorId: "A001" });
  let call: { url: string; init?: RequestInit } | null = null;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    call = init === undefined ? { url: String(input) } : { url: String(input), init };
    return response({ code: "SUCCESS", data: [] });
  }) as typeof fetch;

  const service = new MarketConnectionService(store, fetchMock);
  const result = await service.verify("tenant-a", "coupang");
  assert.equal(result.ok, true);
  assert.ok(call);
  const verifiedCall = call as { url: string; init?: RequestInit };
  assert.match(verifiedCall.url, /seller-products\?vendorId=A001&maxPerPage=1$/);
  const headers = verifiedCall.init?.headers as Record<string, string>;
  assert.equal(headers["X-Requested-By"], "A001");
  assert.equal(headers["X-MARKET"], "KR");
  assert.match(headers.Authorization ?? "", /^CEA algorithm=HmacSHA256,/);
});

test("Toss verification obtains OAuth token then calls a protected product API", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "toss", { accessKey: "TOSS-ACCESS", secretKey: "TOSS-SECRET" });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(init === undefined ? { url: String(input) } : { url: String(input), init });
    if (String(input) === "https://oauth2.cert.toss.im/token") return response({ access_token: "TOSS-TOKEN", expires_in: 1000 });
    return response([{ id: 1, name: "category" }]);
  }) as typeof fetch;

  const service = new MarketConnectionService(store, fetchMock);
  const result = await service.verify("tenant-a", "toss");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(String(calls[0]!.init?.body), /scope=toss-shopping-fep%3Awrite/);
  assert.equal((calls[1]!.init?.headers as Record<string, string>).Authorization, "Bearer TOSS-TOKEN");
});

test("Gmarket, LotteON and Kakao verification use their required auth surfaces", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "gmarket", { masterId: "MASTER", secretKey: "SECRET", gmarketSellerId: "SELLER", issuer: "seller.example.com" });
  await store.set("tenant-a", "lotteon", { apiKey: "LOTTE-KEY" });
  await store.set("tenant-a", "kakao", { adminAppKey: "ADMIN", sellerAppKey: "SELLERKEY", channelIds: "101" });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(init === undefined ? { url: String(input) } : { url: String(input), init });
    if (String(input).includes("esmplus")) return response({ status: { status_code: 200 }, data: [] });
    if (String(input).includes("lotteon")) return response({ returnCode: "SUCCESS", data: "" });
    return response({ content: [] });
  }) as typeof fetch;
  const service = new MarketConnectionService(store, fetchMock);

  assert.equal((await service.verify("tenant-a", "gmarket")).ok, true);
  assert.equal((await service.verify("tenant-a", "lotteon")).ok, true);
  assert.equal((await service.verify("tenant-a", "kakao")).ok, true);

  const gmarket = calls.find((item) => item.url.includes("esmplus"))!;
  assert.match(String((gmarket.init?.headers as Record<string, string>).Authorization), /^Bearer [^.]+\.[^.]+\.[^.]+$/);
  const gBody = JSON.parse(String(gmarket.init?.body)) as { pageIndex: number; pageSize: number };
  assert.equal(gBody.pageIndex, 1);
  assert.equal(gBody.pageSize, 1);

  const lotte = calls.find((item) => item.url.includes("lotteon"))!;
  assert.equal(lotte.url, "https://openapi.lotteon.com/v1/openapi/common/v1/identity");
  assert.equal((lotte.init?.headers as Record<string, string>).Authorization, "Bearer LOTTE-KEY");

  const kakao = calls.find((item) => item.url.includes("kapi.kakao.com"))!;
  const kHeaders = kakao.init?.headers as Record<string, string>;
  assert.equal(kHeaders.Authorization, "KakaoAK ADMIN");
  assert.equal(kHeaders["Target-Authorization"], "KakaoAK SELLERKEY");
  assert.equal(kHeaders["channel-ids"], "101");
});

test("Toss registration returns created product id and rejects business-level failures", async () => {
  const store = await makeStore();
  await store.set("tenant-a", "toss", { accessKey: "ACCESS", secretKey: "SECRET" });
  let shouldFail = false;
  const fetchMock = (async (input: string | URL | Request) => {
    if (String(input) === "https://oauth2.cert.toss.im/token") return response({ access_token: "TOKEN", expires_in: 1000 });
    if (shouldFail) return response({ resultType: "FAIL", error: { reason: "category policy mismatch" } });
    return response({ resultType: "SUCCESS", success: { productId: 987654 } });
  }) as typeof fetch;
  const service = new MarketConnectionService(store, fetchMock);

  const ok = await service.registerProduct("tenant-a", "toss", { name: "상품", categoryId: 10 });
  assert.equal(ok.ok, true);
  assert.equal(ok.externalId, "987654");

  shouldFail = true;
  const failed = await service.registerProduct("tenant-a", "toss", { name: "상품", categoryId: 10 });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /category policy mismatch/);
});
