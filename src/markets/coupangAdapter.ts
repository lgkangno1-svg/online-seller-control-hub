import { createHmac } from "node:crypto";
import { z } from "zod";
import type { CatalogProduct } from "../catalog/catalog.js";
import type { MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import type { MarketAdapter } from "./adapter.js";
import { isRetryableStatus, retryAfterMs, SerialRateLimiter, sleep } from "./rateLimiter.js";

const inventoryResponseSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  message: z.string().optional().default(""),
  data: z.object({
    sellerItemId: z.number().optional(),
    amountInStock: z.number().int().nonnegative(),
    salePrice: z.number().int().nonnegative(),
    onSale: z.boolean()
  })
});

const mutationResponseSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  message: z.string().optional().default("")
});

type CoupangCredentials = {
  accessKey: string;
  secretKey: string;
  vendorId: string;
};

type FetchLike = typeof fetch;

export class CoupangMarketAdapter implements MarketAdapter {
  readonly market = "coupang" as const;
  // Coupang reduced the baseline Open API rate from 10 rps to 5 rps in 2026.
  // Keep a small margin instead of sitting exactly on the documented boundary.
  private readonly limiter = new SerialRateLimiter(220);

  constructor(
    private readonly credentials: EncryptedCredentialStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://api-gateway.coupang.com"
  ) {}

  async getState(product: CatalogProduct): Promise<MarketState> {
    const vendorItemId = externalVendorItemId(product);
    const body = await this.request(
      product.tenantId,
      "GET",
      `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/inventories`
    );
    const parsed = inventoryResponseSchema.parse(body);
    return {
      market: this.market,
      externalId: vendorItemId,
      price: parsed.data.salePrice,
      stock: parsed.data.amountInStock,
      saleStatus: parsed.data.onSale
        ? (parsed.data.amountInStock === 0 ? "OUT_OF_STOCK" : "ON_SALE")
        : "STOPPED"
    };
  }

  async execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult> {
    if (!command.markets.includes(this.market)) {
      throw new Error("Coupang adapter received a command that does not target Coupang");
    }

    const before = await this.getState(product);
    const vendorItemId = before.externalId;
    let path: string;

    switch (command.action) {
      case "SET_OUT_OF_STOCK":
        path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/quantities/0`;
        break;
      case "SET_STOCK": {
        if (command.value === null || !Number.isInteger(command.value) || command.value < 0 || command.value > 99_999) {
          throw new Error("쿠팡 재고는 0~99,999 범위의 정수로 입력해 주세요.");
        }
        path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/quantities/${command.value}`;
        break;
      }
      case "SET_PRICE": {
        if (command.value === null || !Number.isInteger(command.value) || command.value < 10) {
          throw new Error("쿠팡 판매가는 10원 이상의 정수로 입력해 주세요.");
        }
        if (command.value % 10 !== 0) throw new Error("쿠팡 판매가는 10원 단위로 입력해야 합니다.");
        // Keep Coupang's default change-ratio guard. We intentionally do not append
        // forceSalePriceUpdate=true because that disables the typo-protection limit.
        path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/prices/${command.value}`;
        break;
      }
      case "STOP_SALES":
        path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/sales/stop`;
        break;
      case "RESUME_SALES":
        if (before.stock === 0) throw new Error("쿠팡 판매재개 전에 재고를 1개 이상 설정해 주세요.");
        path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/sales/resume`;
        break;
    }

    const response = mutationResponseSchema.parse(await this.request(product.tenantId, "PUT", path));
    const code = String(response.code ?? "SUCCESS").toUpperCase();
    if (code === "ERROR" || code === "FAIL") {
      return { market: this.market, ok: false, message: response.message || "Coupang API rejected the change", before };
    }

    const after = await this.getState(product);
    return {
      market: this.market,
      ok: true,
      message: response.message || "Coupang change completed",
      before,
      after
    };
  }

  private async request(tenantId: string, method: "GET" | "PUT", path: string, query = ""): Promise<unknown> {
    const credentials = this.credentials.get<CoupangCredentials>(tenantId, this.market);
    if (!credentials) throw new Error("Coupang credentials are not configured for this tenant");

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.limiter.wait();
      const signedDate = coupangSignedDate(new Date());
      const signature = createHmac("sha256", credentials.secretKey)
        .update(`${signedDate}${method}${path}${query}`)
        .digest("hex");
      const authorization = `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
          method,
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json;charset=UTF-8",
            "X-Requested-By": credentials.vendorId,
            "X-MARKET": "KR",
            "X-EXTENDED-TIMEOUT": "15000"
          },
          signal: controller.signal
        });
        const text = await response.text();
        const body = text ? safeJson(text) : {};
        if (!response.ok) {
          if (attempt < 2 && isRetryableStatus(response.status)) {
            await sleep(retryAfterMs(response, attempt));
            continue;
          }
          throw new Error(`Coupang API HTTP ${response.status}: ${apiMessage(body)}`);
        }
        return body;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (attempt < 2) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          throw new Error("Coupang API request timed out");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("Coupang API request failed after retries");
  }
}

function externalVendorItemId(product: CatalogProduct): string {
  const value = product.markets.coupang?.externalId?.trim();
  if (!value || !/^\d+$/.test(value)) throw new Error("Coupang mapping must be a numeric vendorItemId");
  return value;
}

export function coupangSignedDate(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 19).replace(/:/g, "")}Z`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Coupang API returned a non-JSON response");
  }
}

function apiMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return "request failed";
}
