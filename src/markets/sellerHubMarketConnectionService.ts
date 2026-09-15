import { createHmac } from "node:crypto";
import { hashSync } from "bcryptjs";
import { z } from "zod";
import type { Market } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import {
  accessTokenCacheKey,
  getCachedAccessToken,
  setCachedAccessToken
} from "./accessTokenCache.js";
import { coupangSignedDate } from "./coupangAdapter.js";
import {
  MarketConnectionService,
  type MarketConnectionCheck,
  type MarketProductRegistrationResult
} from "./marketConnectionService.js";

type NaverSelfCredentials = {
  clientId: string;
  clientSecret: string;
  accountId?: string;
};
type CoupangCredentials = {
  accessKey: string;
  secretKey: string;
  vendorId: string;
};

type CoupangVendorItemResolution =
  | { kind: "ready"; vendorItemId: string }
  | { kind: "pending" }
  | { kind: "multiple"; count: number }
  | { kind: "unavailable"; message: string };

const naverTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional()
});

/**
 * SellerHub currently uses a seller-owned Naver "내 스토어 애플리케이션"
 * for the operator's integration test. Naver requires that application type to
 * issue SELF tokens and forbids account_id in the token request.
 *
 * Commercial multi-seller integration must use the proper Naver solution/API
 * agency onboarding flow. Until that flow is implemented, Naver product writes
 * through this connection service stay fail-closed.
 */
export class SellerHubMarketConnectionService extends MarketConnectionService {
  constructor(
    private readonly sellerHubCredentials: EncryptedCredentialStore,
    private readonly sellerHubFetch: typeof fetch = fetch,
    lotteProductRegisterPath = process.env.LOTTEON_PRODUCT_REGISTER_PATH?.trim() || ""
  ) {
    super(sellerHubCredentials, sellerHubFetch, lotteProductRegisterPath);
  }

  override async verify(tenantId: string, market: Market): Promise<MarketConnectionCheck> {
    if (market !== "naver") return super.verify(tenantId, market);

    const configured = this.sellerHubCredentials.statuses(tenantId)
      .find((item) => item.market === "naver")?.configured;
    if (!configured) {
      return this.naverCheck(false, "API 키가 저장되지 않았습니다.");
    }

    try {
      const token = await this.naverSelfToken(tenantId);
      await this.naverRequestJson("https://api.commerce.naver.com/external/v1/seller/account", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      }, "네이버 판매자 계정 조회");
      return this.naverCheck(true, "네이버 내 스토어 Commerce API 연결 확인에 성공했습니다.");
    } catch (error) {
      return this.naverCheck(false, publicError(error));
    }
  }

  override async registerProduct(
    tenantId: string,
    market: Market,
    payload: unknown
  ): Promise<MarketProductRegistrationResult> {
    if (market === "naver") {
      return {
        market: "naver",
        ok: false,
        message: "네이버 내 스토어 SELF 연결은 현재 연결 검증용입니다. 정식 다중 판매자 연동이 완료되기 전에는 SellerHub에서 네이버 신규 상품 등록을 실행하지 않습니다.",
        externalId: null,
        controlExternalId: null
      };
    }

    const result = await super.registerProduct(tenantId, market, payload);
    if (market !== "coupang" || !result.ok || !result.externalId || result.controlExternalId) return result;

    // Coupang documents that vendorItemId is obtained from the seller-product
    // detail after approval and is required for stock/price/sale-state control.
    // This is a read-only follow-up. Never guess when a product has multiple items.
    const resolution = await this.coupangVendorItemId(tenantId, result.externalId);
    if (resolution.kind === "ready") {
      return {
        ...result,
        controlExternalId: resolution.vendorItemId,
        message: "쿠팡 상품 생성 후 vendorItemId까지 자동 확인했습니다. 재고·가격·판매상태 제어 매핑을 바로 저장할 수 있습니다."
      };
    }
    if (resolution.kind === "multiple") {
      return {
        ...result,
        message: `쿠팡 상품 생성은 성공했지만 옵션이 ${resolution.count}개 확인되어 단일 vendorItemId를 임의 선택하지 않았습니다. 옵션별 매핑 기능이 필요합니다.`
      };
    }
    if (resolution.kind === "unavailable") {
      return {
        ...result,
        message: `쿠팡 상품 생성은 성공했지만 vendorItemId 후속 조회에 실패했습니다. 상품 중복 등록은 하지 말고 승인 상태를 확인해 주세요. (${resolution.message})`
      };
    }
    return {
      ...result,
      message: "쿠팡 상품 생성은 성공했지만 vendorItemId가 아직 생성되지 않았습니다. 쿠팡 승인 완료 후 옵션 매핑을 다시 확인해야 재고·가격·판매상태 제어가 가능합니다."
    };
  }

  private naverCheck(ok: boolean, message: string): MarketConnectionCheck {
    return {
      market: "naver",
      ok,
      message,
      checkedAt: new Date().toISOString(),
      registrationSupported: false
    };
  }

  private async naverSelfToken(tenantId: string): Promise<string> {
    const credentials = this.sellerHubCredentials.get<NaverSelfCredentials>(tenantId, "naver");
    if (!credentials) throw new Error("네이버 API 키가 저장되지 않았습니다.");

    const cacheKey = accessTokenCacheKey("naver-self", tenantId, {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret
    });
    const cached = getCachedAccessToken(cacheKey);
    if (cached) return cached;

    const timestamp = Date.now().toString();
    let signature: string;
    try {
      const hashed = hashSync(`${credentials.clientId}_${timestamp}`, credentials.clientSecret);
      signature = Buffer.from(hashed, "utf8").toString("base64url");
    } catch {
      throw new Error("네이버 Client Secret 형식이 올바르지 않아 전자서명을 만들 수 없습니다.");
    }

    const params = new URLSearchParams({
      client_id: credentials.clientId,
      timestamp,
      client_secret_sign: signature,
      grant_type: "client_credentials",
      type: "SELF"
    });
    const body = await this.naverRequestJson("https://api.commerce.naver.com/external/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: params.toString()
    }, "네이버 OAuth 토큰 발급");
    const parsed = naverTokenSchema.parse(body);
    setCachedAccessToken(cacheKey, parsed.access_token, parsed.expires_in ?? 10_800);
    return parsed.access_token;
  }

  private async coupangVendorItemId(tenantId: string, sellerProductId: string): Promise<CoupangVendorItemResolution> {
    if (!/^\d+$/.test(sellerProductId)) {
      return { kind: "unavailable", message: "쿠팡 등록상품ID 형식이 올바르지 않습니다." };
    }
    const credentials = this.sellerHubCredentials.get<CoupangCredentials>(tenantId, "coupang");
    if (!credentials?.accessKey || !credentials.secretKey || !credentials.vendorId) {
      return { kind: "unavailable", message: "쿠팡 API 키가 저장되지 않았습니다." };
    }

    const path = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`;
    const signedDate = coupangSignedDate(new Date());
    const signature = createHmac("sha256", credentials.secretKey)
      .update(`${signedDate}GET${path}`)
      .digest("hex");
    const authorization = `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;

    try {
      const body = await this.coupangRequestJson(`https://api-gateway.coupang.com${path}`, {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "X-Requested-By": credentials.vendorId,
          "X-MARKET": "KR"
        }
      });
      const root = body && typeof body === "object" ? body as Record<string, unknown> : null;
      if (root && typeof root.code === "string" && ["ERROR", "FAIL"].includes(root.code.toUpperCase())) {
        return { kind: "unavailable", message: messageOf(body) };
      }
      const ids = collectIds(body, "vendorItemId");
      if (ids.length === 1) return { kind: "ready", vendorItemId: ids[0]! };
      if (ids.length > 1) return { kind: "multiple", count: ids.length };
      return { kind: "pending" };
    } catch (error) {
      return { kind: "unavailable", message: publicError(error) };
    }
  }

  private async coupangRequestJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.sellerHubFetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let body: unknown = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { message: text.slice(0, 500) };
        }
      }
      if (!response.ok) throw new Error(`쿠팡 상품 조회 HTTP ${response.status}: ${messageOf(body)}`);
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("쿠팡 상품 조회 요청 시간이 초과되었습니다.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async naverRequestJson(url: string, init: RequestInit, label: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.sellerHubFetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let body: unknown = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { message: text.slice(0, 500) };
        }
      }
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${messageOf(body)}`);
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${label} 요청 시간이 초과되었습니다.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function collectIds(value: unknown, key: string, output = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, key, output);
    return [...output];
  }
  if (!value || typeof value !== "object") return [...output];
  const record = value as Record<string, unknown>;
  const candidate = record[key];
  if (typeof candidate === "string" || typeof candidate === "number") output.add(String(candidate));
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectIds(child, key, output);
  }
  return [...output];
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== "object") return "request failed";
  const root = body as Record<string, unknown>;
  if (typeof root.message === "string") return root.message;
  if (typeof root.code === "string") return root.code;
  return "request failed";
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "마켓 API 연결 확인에 실패했습니다.";
}
