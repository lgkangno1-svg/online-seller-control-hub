import { hashSync } from "bcryptjs";
import { z } from "zod";
import type { CatalogProduct } from "../catalog/catalog.js";
import type { MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import {
  accessTokenCacheKey,
  getOrCreateAccessToken,
  invalidateCachedAccessToken
} from "./accessTokenCache.js";
import type { MarketAdapter } from "./adapter.js";
import { naverApiErrorMessage } from "./naverApiError.js";
import { isRetryableStatus, retryAfterMs, SerialRateLimiter, sleep } from "./rateLimiter.js";

type NaverCredentials = { clientId: string; clientSecret: string; accountId: string };
type FetchLike = typeof fetch;

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.coerce.number().positive().optional() });
type NaverSnapshot = { state: MarketState; rawStatus: string; optionStockManaged: boolean };

export class NaverMarketAdapter implements MarketAdapter {
  readonly market = "naver" as const;
  private readonly limiter = new SerialRateLimiter(60);

  constructor(private readonly credentials: EncryptedCredentialStore, private readonly fetchImpl: FetchLike = fetch, private readonly apiBase = "https://api.commerce.naver.com/external") {}

  async getState(product: CatalogProduct): Promise<MarketState> { return (await this.snapshot(product)).state; }

  async execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult> {
    if (!command.markets.includes(this.market)) throw new Error("Naver adapter received a command that does not target Naver");
    const originProductNo = productNo(product);
    const token = await this.token(product.tenantId);
    const beforeSnapshot = await this.snapshotWithToken(product, token);
    const before = beforeSnapshot.state;
    switch (command.action) {
      case "SET_OUT_OF_STOCK":
        this.assertBaseStockSafe(beforeSnapshot);
        await this.changeStatus(token, originProductNo, { statusType: "OUTOFSTOCK", stockQuantity: 0 });
        break;
      case "SET_STOCK": {
        if (command.value === null || !Number.isInteger(command.value) || command.value < 0 || command.value > 99_999_999) throw new Error("네이버 재고는 0~99,999,999 범위의 정수로 입력해 주세요.");
        this.assertBaseStockSafe(beforeSnapshot);
        const statusType = command.value === 0 ? "OUTOFSTOCK" : beforeSnapshot.rawStatus === "SUSPENSION" ? "SUSPENSION" : "SALE";
        await this.changeStatus(token, originProductNo, { statusType, stockQuantity: command.value });
        break;
      }
      case "SET_PRICE":
        if (command.value === null || !Number.isInteger(command.value) || command.value < 1 || command.value > 999_999_990) throw new Error("네이버 판매가는 1~999,999,990원 범위의 정수로 입력해 주세요.");
        await this.request(token, "/v1/products/origin-products/bulk-update", {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originProductNos: [Number(originProductNo)], productBulkUpdateType: "SALE_PRICE", productSalePrice: { value: command.value, productSalePriceChangerType: "TO", productSalePriceChangerUnitType: "WON" } })
        }, "네이버 판매가 변경");
        break;
      case "STOP_SALES": await this.changeStatus(token, originProductNo, { statusType: "SUSPENSION" }); break;
      case "RESUME_SALES":
        if (beforeSnapshot.optionStockManaged) throw new Error("이 네이버 상품은 옵션별 재고관리 상품입니다. 옵션별 실제 재고를 확인할 수 있을 때까지 자동 판매재개를 차단합니다.");
        if (before.stock === 0) throw new Error("네이버 판매재개 전에 재고를 1개 이상 설정해 주세요.");
        await this.changeStatus(token, originProductNo, { statusType: "SALE" });
        break;
    }
    const after = (await this.snapshotWithToken(product, token)).state;
    return { market: this.market, ok: true, message: "네이버 스마트스토어 변경 완료", before, after };
  }

  private async snapshot(product: CatalogProduct): Promise<NaverSnapshot> { const token = await this.token(product.tenantId); return this.snapshotWithToken(product, token); }

  private async snapshotWithToken(product: CatalogProduct, token: string): Promise<NaverSnapshot> {
    const originProductNo = productNo(product);
    const body = await this.request(token, `/v2/products/origin-products/${encodeURIComponent(originProductNo)}`, { method: "GET" }, "네이버 원상품 조회");
    const root = objectValue(body); const origin = objectValue(root.originProduct);
    if (!Object.keys(origin).length) throw new Error("네이버 원상품 조회 응답에 originProduct가 없습니다.");
    const rawStatus = stringValue(origin.statusType) ?? "UNKNOWN"; const price = finiteNumber(origin.salePrice); const stock = finiteNumber(origin.stockQuantity);
    const detailAttribute = objectValue(origin.detailAttribute); const optionInfo = objectValue(detailAttribute.optionInfo);
    const optionStockManaged = optionInfo.useStockManagement === true && hasManagedOptions(optionInfo);
    return { rawStatus, optionStockManaged, state: { market: this.market, externalId: originProductNo, price, stock, saleStatus: mapStatus(rawStatus, stock) } };
  }

  private assertBaseStockSafe(snapshot: NaverSnapshot) { if (snapshot.optionStockManaged) throw new Error("이 네이버 상품은 옵션별 재고관리 상품입니다. 옵션 재고 API 실계정 검증 전에는 전체 재고 자동변경을 차단합니다."); }
  private async changeStatus(token: string, originProductNo: string, body: Record<string, unknown>) { await this.request(token, `/v1/products/origin-products/${encodeURIComponent(originProductNo)}/change-status`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "네이버 판매상태/재고 변경"); }

  private async token(tenantId: string): Promise<string> {
    const credentials = this.credentials.get<NaverCredentials>(tenantId, this.market);
    if (!credentials) throw new Error("Naver credentials are not configured for this tenant");
    const cacheKey = accessTokenCacheKey(this.market, tenantId, credentials);
    return getOrCreateAccessToken(cacheKey, async () => {
      const timestamp = Date.now().toString();
      let hashed: string;
      try { hashed = hashSync(`${credentials.clientId}_${timestamp}`, credentials.clientSecret); }
      catch { throw new Error("네이버 Client Secret 형식이 올바르지 않아 전자서명을 만들 수 없습니다."); }
      const params = new URLSearchParams({ client_id: credentials.clientId, timestamp, client_secret_sign: Buffer.from(hashed, "utf8").toString("base64url"), grant_type: "client_credentials", type: "SELLER", account_id: credentials.accountId });
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await this.fetchImpl(`${this.apiBase}/v1/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: params.toString(), signal: controller.signal });
        const body = await parseJson(response);
        if (!response.ok) throw new Error(naverApiErrorMessage("네이버 OAuth", response, body));
        const parsed = tokenSchema.parse(body);
        return { accessToken: parsed.access_token, expiresInSeconds: parsed.expires_in ?? 10_800 };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("네이버 OAuth 요청 시간이 초과되었습니다.");
        throw error;
      } finally { clearTimeout(timeout); }
    });
  }

  private async request(token: string, path: string, init: RequestInit, label: string): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.limiter.wait(); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers }, signal: controller.signal });
        const body = await parseJson(response);
        if (!response.ok) {
          if (response.status === 401) invalidateCachedAccessToken(token);
          if (attempt < 2 && isRetryableStatus(response.status)) { await sleep(retryAfterMs(response, attempt)); continue; }
          throw new Error(naverApiErrorMessage(label, response, body));
        }
        return body;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") { if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; } throw new Error(`${label} 요청 시간이 초과되었습니다.`); }
        throw error;
      } finally { clearTimeout(timeout); }
    }
    throw new Error(`${label} 요청이 반복 실패했습니다.`);
  }
}

function productNo(product: CatalogProduct): string { const value = (product.markets.naver?.productId ?? product.markets.naver?.externalId)?.trim(); if (!value || !/^\d+$/.test(value)) throw new Error("네이버 매핑에는 숫자형 원상품번호(originProductNo)가 필요합니다."); return value; }
function mapStatus(status: string, stock: number | null): MarketState["saleStatus"] { if (status === "SUSPENSION" || status === "CLOSE" || status === "PROHIBITION") return "STOPPED"; if (status === "OUTOFSTOCK" || stock === 0) return "OUT_OF_STOCK"; if (status === "SALE") return "ON_SALE"; return "UNKNOWN"; }
function hasManagedOptions(optionInfo: Record<string, unknown>): boolean { return ["optionSimple", "optionCustom", "optionCombinations", "optionStandards"].some((key) => Array.isArray(optionInfo[key]) && (optionInfo[key] as unknown[]).length > 0); }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function finiteNumber(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
async function parseJson(response: Response): Promise<unknown> { const text = await response.text(); if (!text.trim()) return {}; try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; } }
