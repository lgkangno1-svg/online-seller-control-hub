import { z } from "zod";
import type { CatalogProduct } from "../catalog/catalog.js";
import type { MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import {
  accessTokenCacheKey,
  getCachedAccessToken,
  invalidateCachedAccessToken,
  setCachedAccessToken
} from "./accessTokenCache.js";
import type { MarketAdapter } from "./adapter.js";
import { isRetryableStatus, retryAfterMs, SerialRateLimiter, sleep } from "./rateLimiter.js";

type TossCredentials = { accessKey: string; secretKey: string };
type FetchLike = typeof fetch;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional()
});

export class TossMarketAdapter implements MarketAdapter {
  readonly market = "toss" as const;
  // Toss documents 50 rps for reads and 30 rps for writes per seller/API.
  // Keep a small safety margin to avoid burst-boundary rejections.
  private readonly readLimiter = new SerialRateLimiter(25);
  private readonly writeLimiter = new SerialRateLimiter(40);

  constructor(
    private readonly credentials: EncryptedCredentialStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly apiBase = "https://shopping-fep.toss.im",
    private readonly tokenBase = "https://oauth2.cert.toss.im"
  ) {}

  async getState(product: CatalogProduct): Promise<MarketState> {
    const { productId, productItemId } = mapping(product);
    const token = await this.token(product.tenantId);
    const productBody = await this.request(
      `${this.apiBase}/api/v3/shopping-fep/products/${encodeURIComponent(productId)}/v2?partnerName=SellerHub`,
      token,
      { method: "GET" },
      "토스쇼핑 상품 조회"
    );
    assertSuccess(productBody);

    const itemsBody = await this.request(
      `${this.apiBase}/api/v3/shopping-fep/products/${encodeURIComponent(productId)}/product-items?pageSize=50&itemIds=${encodeURIComponent(productItemId)}`,
      token,
      { method: "GET" },
      "토스쇼핑 옵션 조회"
    );
    assertSuccess(itemsBody);

    const item = findObjectWithId(itemsBody, productItemId);
    if (!item) throw new Error(`토스쇼핑 옵션 ${productItemId}을(를) 조회 결과에서 찾지 못했습니다.`);
    const stock = numberField(item, ["remainingCount", "stock", "stockQuantity"]);
    const price = numberField(item, ["salePrice", "price"]);
    const exposure = stringField(deepSuccess(productBody), ["exposureStatus", "status"]);
    const hidden = exposure ? !["EXPOSURE", "SHOW", "ON_SALE", "SALE"].includes(exposure.toUpperCase()) : false;

    return {
      market: this.market,
      externalId: productItemId,
      price,
      stock,
      saleStatus: hidden ? "STOPPED" : stock === 0 ? "OUT_OF_STOCK" : "ON_SALE"
    };
  }

  async execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult> {
    if (!command.markets.includes(this.market)) throw new Error("Toss adapter received a command that does not target Toss");
    const before = await this.getState(product);
    const { productId, productItemId } = mapping(product);
    const token = await this.token(product.tenantId);

    switch (command.action) {
      case "SET_OUT_OF_STOCK":
        await this.mutate(token, `/api/v3/shopping-fep/product-items/${productItemId}/stocks/normal-stock/remaining-count`, "PUT", {
          productId: Number(productId), remainingCount: 0, partnerName: "SellerHub"
        }, "토스쇼핑 품절 처리");
        break;
      case "SET_STOCK":
        if (command.value === null || !Number.isInteger(command.value) || command.value < 0) throw new Error("토스쇼핑 재고는 0 이상의 정수로 입력해 주세요.");
        await this.mutate(token, `/api/v3/shopping-fep/product-items/${productItemId}/stocks/normal-stock/remaining-count`, "PUT", {
          productId: Number(productId), remainingCount: command.value, partnerName: "SellerHub"
        }, "토스쇼핑 재고 변경");
        break;
      case "SET_PRICE":
        if (command.value === null || !Number.isInteger(command.value) || command.value < 1) throw new Error("토스쇼핑 판매가는 1원 이상의 정수로 입력해 주세요.");
        await this.mutate(token, `/api/v3/shopping-fep/product-items/${productItemId}/sale-price`, "PUT", {
          productId: Number(productId), salePrice: command.value, partnerName: "SellerHub"
        }, "토스쇼핑 판매가 변경");
        break;
      case "STOP_SALES":
        await this.mutate(token, "/api/v3/shopping-fep/products/hide", "POST", { productId: Number(productId), partnerName: "SellerHub" }, "토스쇼핑 상품 숨김");
        break;
      case "RESUME_SALES":
        if (before.stock === 0) throw new Error("토스쇼핑 판매재개 전에 재고를 1개 이상 설정해 주세요.");
        await this.mutate(token, "/api/v3/shopping-fep/products/show", "POST", { productId: Number(productId), partnerName: "SellerHub" }, "토스쇼핑 상품 노출");
        break;
    }

    const after = await this.getState(product);
    return { market: this.market, ok: true, message: "토스쇼핑 변경 완료", before, after };
  }

  private async mutate(token: string, path: string, method: "PUT" | "POST", body: unknown, label: string) {
    const result = await this.request(`${this.apiBase}${path}`, token, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, label);
    assertSuccess(result);
  }

  private async token(tenantId: string): Promise<string> {
    const credentials = this.credentials.get<TossCredentials>(tenantId, this.market);
    if (!credentials) throw new Error("Toss credentials are not configured for this tenant");
    const cacheKey = accessTokenCacheKey(this.market, tenantId, credentials);
    const cached = getCachedAccessToken(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.accessKey,
      client_secret: credentials.secretKey,
      scope: "toss-shopping-fep:write"
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(`${this.tokenBase}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: params.toString(),
        signal: controller.signal
      });
      const body = await parseJson(response);
      if (!response.ok) throw new Error(`토스쇼핑 OAuth HTTP ${response.status}: ${messageOf(body)}`);
      const parsed = tokenSchema.parse(body);
      setCachedAccessToken(cacheKey, parsed.access_token, parsed.expires_in ?? 31_535_999);
      return parsed.access_token;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("토스쇼핑 OAuth 요청 시간이 초과되었습니다.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(url: string, token: string, init: RequestInit, label: string): Promise<unknown> {
    const method = String(init.method ?? "GET").toUpperCase();
    const limiter = method === "GET" ? this.readLimiter : this.writeLimiter;

    for (let attempt = 0; attempt < 3; attempt++) {
      await limiter.wait();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...init.headers },
          signal: controller.signal
        });
        const body = await parseJson(response);
        if (!response.ok) {
          if (response.status === 401) invalidateCachedAccessToken(token);
          if (attempt < 2 && isRetryableStatus(response.status)) {
            await sleep(retryAfterMs(response, attempt));
            continue;
          }
          throw new Error(`${label} HTTP ${response.status}: ${messageOf(body)}`);
        }
        if (isTooManyRequest(body) && attempt < 2) {
          await sleep(400 * 2 ** attempt);
          continue;
        }
        return body;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (attempt < 2) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          throw new Error(`${label} 요청 시간이 초과되었습니다.`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`${label} 요청이 반복 실패했습니다.`);
  }
}

function mapping(product: CatalogProduct): { productId: string; productItemId: string } {
  const productId = product.markets.toss?.productId?.trim();
  const productItemId = product.markets.toss?.externalId?.trim();
  if (!productId || !/^\d+$/.test(productId)) throw new Error("Toss mapping requires a numeric productId");
  if (!productItemId || !/^\d+$/.test(productItemId)) throw new Error("Toss mapping requires a numeric productItemId control ID");
  return { productId, productItemId };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("토스쇼핑 API가 JSON이 아닌 응답을 반환했습니다."); }
}

function assertSuccess(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("토스쇼핑 API 응답이 비어 있습니다.");
  const record = body as Record<string, unknown>;
  if (typeof record.resultType === "string" && record.resultType.toUpperCase() !== "SUCCESS") {
    throw new Error(messageOf(body));
  }
}

function isTooManyRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const root = body as Record<string, unknown>;
  const type = typeof root.errorType === "string"
    ? root.errorType
    : root.error && typeof root.error === "object" && typeof (root.error as Record<string, unknown>).errorType === "string"
      ? String((root.error as Record<string, unknown>).errorType)
      : "";
  return type.toUpperCase() === "TOO_MANY_REQUEST";
}

function deepSuccess(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const root = body as Record<string, unknown>;
  return root.success && typeof root.success === "object" && !Array.isArray(root.success)
    ? root.success as Record<string, unknown>
    : root;
}

function findObjectWithId(value: unknown, id: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectWithId(item, id);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "itemId", "productItemId"]) {
    if (record[key] !== undefined && String(record[key]) === id) return record;
  }
  for (const child of Object.values(record)) {
    const found = findObjectWithId(child, id);
    if (found) return found;
  }
  return null;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) if (typeof record[key] === "string") return record[key] as string;
  return null;
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== "object") return "request failed";
  const root = body as Record<string, unknown>;
  if (root.error && typeof root.error === "object") {
    const error = root.error as Record<string, unknown>;
    if (typeof error.reason === "string") return error.reason;
    if (typeof error.message === "string") return error.message;
  }
  if (typeof root.message === "string") return root.message;
  return "request failed";
}
