import { createHmac } from "node:crypto";
import { hashSync } from "bcryptjs";
import { z } from "zod";
import type { Market } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import {
  accessTokenCacheKey,
  getCachedAccessToken,
  invalidateCachedAccessToken,
  setCachedAccessToken
} from "./accessTokenCache.js";
import { coupangSignedDate } from "./coupangAdapter.js";
import { isRetryableStatus, retryAfterMs, sleep } from "./rateLimiter.js";

type FetchLike = typeof fetch;
type NaverCredentials = { clientId: string; clientSecret: string; accountId: string };
type CoupangCredentials = { accessKey: string; secretKey: string; vendorId: string };
type GmarketTenantCredentials = {
  masterId?: string;
  secretKey?: string;
  gmarketSellerId: string;
  issuer?: string;
};
type GmarketCredentials = { masterId: string; secretKey: string; gmarketSellerId: string; issuer: string };
type LotteCredentials = { apiKey: string };
type TossCredentials = { accessKey: string; secretKey: string };
type KakaoTenantCredentials = { adminAppKey?: string; sellerAppKey: string; channelIds: string };
type KakaoCredentials = { adminAppKey: string; sellerAppKey: string; channelIds: string };

export type MarketOperatorCredentials = {
  gmarketMasterId: string | null;
  gmarketSecretKey: string | null;
  gmarketIssuer: string | null;
  kakaoAdminAppKey: string | null;
};

export type MarketConnectionCheck = {
  market: Market;
  ok: boolean;
  message: string;
  checkedAt: string;
  registrationSupported: boolean;
};

export type MarketProductRegistrationResult = {
  market: Market;
  ok: boolean;
  message: string;
  externalId: string | null;
  controlExternalId?: string | null;
};

const naverTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional()
});
const tossTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional()
});

export class MarketConnectionService {
  constructor(
    private readonly credentials: EncryptedCredentialStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly lotteProductRegisterPath = process.env.LOTTEON_PRODUCT_REGISTER_PATH?.trim() || "",
    private readonly operatorCredentials: MarketOperatorCredentials = operatorCredentialsFromEnv()
  ) {}

  async verify(tenantId: string, market: Market): Promise<MarketConnectionCheck> {
    const configured = this.credentials.statuses(tenantId).find((item) => item.market === market)?.configured;
    if (!configured) return this.check(market, false, "API 키가 저장되지 않았습니다.", this.registrationSupported(market));

    try {
      switch (market) {
        case "naver": {
          const token = await this.naverToken(tenantId);
          await this.requestJson("https://api.commerce.naver.com/external/v1/seller/account", {
            headers: { Authorization: `Bearer ${token}` }
          }, "네이버 판매자 계정 조회", token);
          return this.check(market, true, "네이버 Commerce API 판매자 계정 조회에 성공했습니다.", true);
        }
        case "coupang": {
          const body = await this.coupangRequest(tenantId, "GET", "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", this.coupangListQuery(tenantId));
          assertBusinessSuccess(market, body);
          return this.check(market, true, "쿠팡 Open API 상품목록 조회에 성공했습니다.", true);
        }
        case "gmarket": {
          const credentials = this.gmarketCredentials(tenantId);
          const body = await this.gmarketRequest(tenantId, "/item/v1/goods/search", {
            query: { siteId: [2], siteSellerId: [credentials.gmarketSellerId] },
            pageIndex: 1,
            pageSize: 1
          });
          assertBusinessSuccess(market, body);
          return this.check(market, true, "G마켓 ESM 셀링툴 인증으로 판매자 상품목록 조회에 성공했습니다.", true);
        }
        case "lotteon": {
          const body = await this.lotteRequest(tenantId, "GET", "/v1/openapi/common/v1/identity");
          assertBusinessSuccess(market, body);
          return this.check(
            market,
            true,
            this.lotteProductRegisterPath
              ? "롯데ON OpenAPI 인증 확인에 성공했습니다."
              : "롯데ON OpenAPI 인증 확인에 성공했습니다. 상품등록 경로는 배포 설정 후 활성화됩니다.",
            Boolean(this.lotteProductRegisterPath)
          );
        }
        case "toss": {
          const token = await this.tossToken(tenantId);
          await this.requestJson("https://shopping-fep.toss.im/api/v3/shopping-fep/products/categories/children", {
            headers: { Authorization: `Bearer ${token}` }
          }, "토스쇼핑 카테고리 조회", token);
          return this.check(market, true, "토스쇼핑 OAuth 및 상품 API 접근 확인에 성공했습니다.", true);
        }
        case "kakao": {
          this.assertKakaoTalkStoreChannel(tenantId);
          const body = await this.kakaoRequest(tenantId, "GET", "/v1/shopping/bizseller/seller-addresses/search?page=0");
          assertBusinessSuccess(market, body);
          return this.check(market, true, "카카오 톡스토어 판매자 API 접근 확인에 성공했습니다.", true);
        }
      }
    } catch (error) {
      return this.check(market, false, publicError(error), this.registrationSupported(market));
    }
  }

  async registerProduct(tenantId: string, market: Market, payload: unknown): Promise<MarketProductRegistrationResult> {
    const product = z.record(z.unknown()).parse(payload);
    try {
      let body: unknown;
      let idKeys: string[];

      switch (market) {
        case "naver": {
          const token = await this.naverToken(tenantId);
          body = await this.requestJson("https://api.commerce.naver.com/external/v2/products", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(product)
          }, "네이버 상품 등록", token);
          idKeys = ["originProductNo", "smartstoreChannelProductNo", "channelProductNo"];
          break;
        }
        case "coupang": {
          const credentials = this.required<CoupangCredentials>(tenantId, market);
          body = await this.coupangRequest(
            tenantId,
            "POST",
            "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products",
            "",
            { ...product, vendorId: product.vendorId ?? credentials.vendorId }
          );
          idKeys = ["sellerProductId", "data"];
          break;
        }
        case "gmarket":
          body = await this.gmarketRequest(tenantId, "/item/v1/goods", product);
          idKeys = ["goodsNo", "masterGoodsNo", "data"];
          break;
        case "lotteon":
          if (!this.lotteProductRegisterPath) throw new Error("롯데ON 상품등록 API 경로가 아직 배포 설정에 등록되지 않았습니다.");
          body = await this.lotteRequest(tenantId, "POST", this.lotteProductRegisterPath, product);
          idKeys = ["productId", "goodsNo", "data"];
          break;
        case "toss": {
          const token = await this.tossToken(tenantId);
          body = await this.requestJson("https://shopping-fep.toss.im/api/v3/shopping-fep/products/v2", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(product)
          }, "토스쇼핑 상품 등록", token);
          idKeys = ["productId", "id", "success"];
          break;
        }
        case "kakao":
          this.assertKakaoTalkStoreChannel(tenantId);
          body = await this.kakaoRequest(tenantId, "POST", "/v1/store/product/register", product);
          idKeys = ["productId"];
          break;
      }

      assertBusinessSuccess(market, body);
      const externalId = findId(body, idKeys);
      if (!externalId) {
        throw new Error(`${market} 상품 등록 응답에서 외부 상품번호를 확인하지 못했습니다. 자동 매핑을 중단했습니다.`);
      }
      const controlExternalId = market === "coupang"
        ? findId(body, ["vendorItemId"])
        : market === "toss"
          ? findId(body, ["itemId", "productItemId"])
          : null;
      return {
        market,
        ok: true,
        message: market === "coupang" && !controlExternalId
          ? "쿠팡 상품 생성은 성공했지만 vendorItemId는 승인 후 생성됩니다. 승인 완료 뒤 상품 매핑에서 vendorItemId를 연결해야 재고·가격·판매상태 제어가 가능합니다."
          : market === "gmarket"
            ? "G마켓 상품 등록 요청이 성공했습니다. ESM 정책상 등록 직후 약 3분간 가격·재고·판매상태 변경이 제한될 수 있습니다."
            : `${market} 상품 등록 요청이 성공했습니다.`,
        externalId,
        ...(controlExternalId ? { controlExternalId } : {})
      };
    } catch (error) {
      return { market, ok: false, message: publicError(error), externalId: null, controlExternalId: null };
    }
  }

  private check(market: Market, ok: boolean, message: string, registrationSupported: boolean): MarketConnectionCheck {
    return { market, ok, message, checkedAt: new Date().toISOString(), registrationSupported };
  }

  private registrationSupported(market: Market): boolean {
    return market !== "lotteon" || Boolean(this.lotteProductRegisterPath);
  }

  private required<T>(tenantId: string, market: Market): T {
    const value = this.credentials.get<T>(tenantId, market);
    if (!value) throw new Error(`${market} API 키가 저장되지 않았습니다.`);
    return value;
  }

  private gmarketCredentials(tenantId: string): GmarketCredentials {
    const seller = this.required<GmarketTenantCredentials>(tenantId, "gmarket");
    const masterId = this.operatorCredentials.gmarketMasterId ?? seller.masterId?.trim() ?? null;
    const secretKey = this.operatorCredentials.gmarketSecretKey ?? seller.secretKey?.trim() ?? null;
    const issuer = this.operatorCredentials.gmarketIssuer ?? seller.issuer?.trim() ?? null;
    if (!masterId || !secretKey || !issuer) {
      throw new Error("G마켓은 SellerHub 운영자의 ESM 셀링툴 승인정보가 아직 설정되지 않았습니다. 판매자가 Master ID나 Secret Key를 대신 입력할 필요는 없습니다.");
    }
    return { masterId, secretKey, issuer, gmarketSellerId: seller.gmarketSellerId };
  }

  private kakaoCredentials(tenantId: string): KakaoCredentials {
    const seller = this.required<KakaoTenantCredentials>(tenantId, "kakao");
    const adminAppKey = this.operatorCredentials.kakaoAdminAppKey ?? seller.adminAppKey?.trim() ?? null;
    if (!adminAppKey) {
      throw new Error("카카오쇼핑은 SellerHub 연동대행사 Admin Key 설정이 먼저 필요합니다. 판매자가 Admin Key를 입력할 필요는 없습니다.");
    }
    return { adminAppKey, sellerAppKey: seller.sellerAppKey, channelIds: seller.channelIds };
  }

  private assertKakaoTalkStoreChannel(tenantId: string): void {
    const credentials = this.kakaoCredentials(tenantId);
    const ids = credentials.channelIds.split(",").map((value) => value.trim()).filter(Boolean);
    if (!ids.includes("101")) {
      throw new Error("카카오 톡스토어 API는 channel-ids에 101이 포함되어야 합니다. 선물하기 전용 채널 ID만으로는 톡스토어 상품을 제어할 수 없습니다.");
    }
  }

  private async naverToken(tenantId: string): Promise<string> {
    const credentials = this.required<NaverCredentials>(tenantId, "naver");
    const cacheKey = accessTokenCacheKey("naver", tenantId, credentials);
    const cached = getCachedAccessToken(cacheKey);
    if (cached) return cached;

    const timestamp = Date.now().toString();
    let hashed: string;
    try {
      hashed = hashSync(`${credentials.clientId}_${timestamp}`, credentials.clientSecret);
    } catch {
      throw new Error("네이버 Client Secret 형식이 올바르지 않거나 전자서명을 만들 수 없습니다.");
    }
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      timestamp,
      client_secret_sign: Buffer.from(hashed, "utf8").toString("base64url"),
      grant_type: "client_credentials",
      type: "SELLER",
      account_id: credentials.accountId
    });
    const body = await this.requestJson("https://api.commerce.naver.com/external/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    }, "네이버 OAuth 토큰 발급");
    const parsed = naverTokenSchema.parse(body);
    setCachedAccessToken(cacheKey, parsed.access_token, parsed.expires_in ?? 10_800);
    return parsed.access_token;
  }

  private coupangListQuery(tenantId: string): string {
    const credentials = this.required<CoupangCredentials>(tenantId, "coupang");
    return new URLSearchParams({ vendorId: credentials.vendorId, maxPerPage: "1" }).toString();
  }

  private async coupangRequest(
    tenantId: string,
    method: "GET" | "POST",
    path: string,
    query = "",
    body?: unknown
  ): Promise<unknown> {
    const credentials = this.required<CoupangCredentials>(tenantId, "coupang");
    const signedDate = coupangSignedDate(new Date());
    const signature = createHmac("sha256", credentials.secretKey).update(`${signedDate}${method}${path}${query}`).digest("hex");
    const authorization = `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;
    return this.requestJson(`https://api-gateway.coupang.com${path}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json;charset=UTF-8",
        "X-Requested-By": credentials.vendorId,
        "X-MARKET": "KR"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }, "쿠팡 Open API");
  }

  private async tossToken(tenantId: string): Promise<string> {
    const credentials = this.required<TossCredentials>(tenantId, "toss");
    const cacheKey = accessTokenCacheKey("toss", tenantId, credentials);
    const cached = getCachedAccessToken(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.accessKey,
      client_secret: credentials.secretKey,
      scope: "toss-shopping-fep:write"
    });
    const body = await this.requestJson("https://oauth2.cert.toss.im/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: params.toString()
    }, "토스쇼핑 OAuth 토큰 발급");
    const parsed = tossTokenSchema.parse(body);
    setCachedAccessToken(cacheKey, parsed.access_token, parsed.expires_in ?? 31_535_999);
    return parsed.access_token;
  }

  private async lotteRequest(tenantId: string, method: "GET" | "POST", path: string, body?: unknown) {
    const credentials = this.required<LotteCredentials>(tenantId, "lotteon");
    return this.requestJson(`https://openapi.lotteon.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        Accept: "application/json",
        "Accept-Language": "ko",
        "X-Timezone": "GMT+09:00",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }, "롯데ON OpenAPI");
  }

  private async gmarketRequest(tenantId: string, path: string, body: unknown): Promise<unknown> {
    const credentials = this.gmarketCredentials(tenantId);
    const token = esmJwt(credentials);
    return this.requestJson(`https://sa2.esmplus.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, "G마켓 ESM Trading API");
  }

  private async kakaoRequest(tenantId: string, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const credentials = this.kakaoCredentials(tenantId);
    return this.requestJson(`https://kapi.kakao.com${path}`, {
      method,
      headers: {
        Authorization: `KakaoAK ${credentials.adminAppKey}`,
        "Target-Authorization": `KakaoAK ${credentials.sellerAppKey}`,
        "channel-ids": credentials.channelIds,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }, "카카오쇼핑 API");
  }

  private async requestJson(url: string, init: RequestInit, label: string, bearerToken?: string): Promise<unknown> {
    const method = String(init.method ?? "GET").toUpperCase();
    const safeToRetry = method === "GET" || method === "HEAD";
    const maxAttempts = safeToRetry ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        const text = await response.text();
        const parsed = text ? safeJson(text) : {};
        if (!response.ok) {
          if (response.status === 401 && bearerToken) invalidateCachedAccessToken(bearerToken);
          if (safeToRetry && attempt < maxAttempts - 1 && isRetryableStatus(response.status)) {
            await sleep(retryAfterMs(response, attempt));
            continue;
          }
          throw new Error(`${label} HTTP ${response.status}: ${messageOf(parsed)}`);
        }
        return parsed;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (safeToRetry && attempt < maxAttempts - 1) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          const suffix = safeToRetry ? "" : " 결과가 불명확할 수 있으므로 자동 재시도하지 않았습니다. 마켓에서 생성 여부를 먼저 확인해 주세요.";
          throw new Error(`${label} 요청 시간이 초과되었습니다.${suffix}`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`${label} 요청이 반복 실패했습니다.`);
  }
}

function operatorCredentialsFromEnv(): MarketOperatorCredentials {
  return {
    gmarketMasterId: process.env.GMARKET_OPERATOR_MASTER_ID?.trim() || null,
    gmarketSecretKey: process.env.GMARKET_OPERATOR_SECRET_KEY?.trim() || null,
    gmarketIssuer: process.env.GMARKET_OPERATOR_ISSUER?.trim() || null,
    kakaoAdminAppKey: process.env.KAKAO_OPERATOR_ADMIN_APP_KEY?.trim() || null
  };
}

function assertBusinessSuccess(market: Market, body: unknown): void {
  if (!body || typeof body !== "object") return;
  const record = body as Record<string, unknown>;
  if (market === "toss" && typeof record.resultType === "string" && record.resultType.toUpperCase() !== "SUCCESS") {
    const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
    throw new Error(typeof error?.reason === "string" ? error.reason : "토스쇼핑 상품 등록이 거절되었습니다.");
  }
  if (market === "coupang" && typeof record.code === "string") {
    const code = record.code.toUpperCase();
    if (code === "ERROR" || code === "FAIL") throw new Error(messageOf(record));
  }
  if (market === "lotteon" && typeof record.returnCode === "string" && record.returnCode.toUpperCase() !== "SUCCESS") throw new Error(messageOf(record));
  if (market === "gmarket" && record.status && typeof record.status === "object") {
    const status = record.status as Record<string, unknown>;
    const statusCode = Number(status.status_code ?? status.statusCode ?? 200);
    if (Number.isFinite(statusCode) && statusCode >= 400) throw new Error(messageOf(record));
  }
  if (market === "kakao" && typeof record.code === "number" && record.code < 0) throw new Error(messageOf(record));
}

function findId(value: unknown, keys: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findId(item, keys);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
    if (candidate && typeof candidate === "object") {
      const nested = findId(candidate, keys);
      if (nested) return nested;
    }
  }
  for (const candidate of Object.values(record)) {
    if (candidate && typeof candidate === "object") {
      const nested = findId(candidate, keys);
      if (nested) return nested;
    }
  }
  return null;
}

function esmJwt(credentials: GmarketCredentials): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: credentials.masterId }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.issuer,
    sub: "sell",
    aud: "sa.esmplus.com",
    iat: Math.floor(Date.now() / 1000),
    ssi: `G:${credentials.gmarketSellerId}`
  }));
  const signature = createHmac("sha256", credentials.secretKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) || "non-JSON response" }; }
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== "object") return "request failed";
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.reason === "string") return error.reason;
    if (typeof error.message === "string") return error.message;
  }
  if (record.status && typeof record.status === "object") {
    const status = record.status as Record<string, unknown>;
    if (typeof status.message === "string") return status.message;
  }
  return "request failed";
}

function publicError(error: unknown): string {
  if (error instanceof z.ZodError) return `API 응답 형식 확인 실패: ${error.issues.map((issue) => issue.message).join(", ")}`;
  return error instanceof Error ? error.message : String(error);
}
