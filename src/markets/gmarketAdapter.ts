import { createHmac } from "node:crypto";
import type { CatalogProduct } from "../catalog/catalog.js";
import type { MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import type { MarketAdapter } from "./adapter.js";

type GmarketCredentials = {
  masterId: string;
  secretKey: string;
  gmarketSellerId: string;
  issuer: string;
};

type FetchLike = typeof fetch;

type SellStatus = {
  gmktSell: boolean;
  iacSell: boolean;
  gmktPrice: number;
  iacPrice: number;
  gmktStock: number;
  iacStock: number;
};

export class GmarketMarketAdapter implements MarketAdapter {
  readonly market = "gmarket" as const;

  constructor(
    private readonly credentials: EncryptedCredentialStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://sa2.esmplus.com"
  ) {}

  async getState(product: CatalogProduct): Promise<MarketState> {
    const goodsNo = masterGoodsNo(product);
    const status = await this.getSellStatus(product.tenantId, goodsNo);
    return {
      market: this.market,
      externalId: goodsNo,
      price: status.gmktPrice,
      stock: status.gmktStock,
      saleStatus: status.gmktSell ? (status.gmktStock === 0 ? "OUT_OF_STOCK" : "ON_SALE") : "STOPPED"
    };
  }

  async execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult> {
    if (!command.markets.includes(this.market)) throw new Error("Gmarket adapter received a command that does not target Gmarket");

    const goodsNo = masterGoodsNo(product);
    const beforeStatus = await this.getSellStatus(product.tenantId, goodsNo);
    const before = stateFrom(goodsNo, beforeStatus);
    const next: SellStatus = { ...beforeStatus };

    switch (command.action) {
      case "SET_OUT_OF_STOCK":
      case "STOP_SALES":
        next.gmktSell = false;
        break;
      case "SET_STOCK":
        if (command.value === null || !Number.isInteger(command.value) || command.value < 0) {
          throw new Error("G마켓 재고는 0 이상의 정수로 입력해 주세요.");
        }
        if (command.value === 0) {
          next.gmktSell = false;
        } else {
          if (command.value > 99_999) throw new Error("G마켓 본품 재고는 최대 99,999개입니다.");
          next.gmktStock = command.value;
        }
        break;
      case "SET_PRICE":
        if (command.value === null || !Number.isInteger(command.value) || command.value < 10 || command.value >= 1_000_000_000) {
          throw new Error("G마켓 가격은 10원 이상 10억원 미만의 정수로 입력해 주세요.");
        }
        if (command.value % 10 !== 0) throw new Error("G마켓 판매가는 10원 단위로 입력해야 합니다.");
        if (!beforeStatus.gmktSell) throw new Error("G마켓 판매중지 상품은 가격 수정이 반영되지 않습니다. 먼저 판매재개해 주세요.");
        next.gmktPrice = command.value;
        break;
      case "RESUME_SALES":
        if (beforeStatus.gmktStock < 1) throw new Error("G마켓 판매재개 전 재고를 1개 이상 설정해야 합니다.");
        next.gmktSell = true;
        break;
    }

    await this.putSellStatus(product.tenantId, goodsNo, next);
    const afterStatus = await this.getSellStatus(product.tenantId, goodsNo);
    const after = stateFrom(goodsNo, afterStatus);
    const becomesStopped = command.action === "SET_OUT_OF_STOCK"
      || command.action === "STOP_SALES"
      || (command.action === "SET_STOCK" && command.value === 0);
    return {
      market: this.market,
      ok: true,
      message: becomesStopped
        ? "G마켓은 본품 재고 0을 허용하지 않아 판매중지로 처리했습니다. ESM 정책상 판매중지 상태가 1개월 유지되면 상품이 삭제될 수 있으므로 30일 전에 재입고·판매재개 여부를 반드시 점검해야 합니다."
        : "G마켓 변경 완료",
      before,
      after
    };
  }

  private async getSellStatus(tenantId: string, goodsNo: string): Promise<SellStatus> {
    const body = await this.request(tenantId, "GET", `/item/v1/goods/${encodeURIComponent(goodsNo)}/sell-status`);
    assertSuccess(body);
    return parseSellStatus(body);
  }

  private async putSellStatus(tenantId: string, goodsNo: string, status: SellStatus): Promise<void> {
    // ESM requires both Gmarket and Auction values in one request. Preserve Auction exactly.
    // sellingPeriod=0 means keep the existing selling period on this partial update endpoint.
    const body = {
      isSell: { gmkt: status.gmktSell, iac: status.iacSell },
      itemBasicInfo: {
        price: { gmkt: status.gmktPrice, iac: status.iacPrice },
        stock: {
          gmkt: Math.max(1, Math.trunc(status.gmktStock)),
          iac: Math.max(1, Math.trunc(status.iacStock))
        },
        sellingPeriod: { gmkt: 0, iac: 0 }
      }
    };
    const response = await this.request(tenantId, "PUT", `/item/v1/goods/${encodeURIComponent(goodsNo)}/sell-status`, body);
    assertSuccess(response);
  }

  private async request(tenantId: string, method: "GET" | "PUT", path: string, body?: unknown): Promise<unknown> {
    const credentials = this.credentials.get<GmarketCredentials>(tenantId, this.market);
    if (!credentials) throw new Error("Gmarket credentials are not configured for this tenant");
    const token = esmJwt(credentials);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(method === "PUT" ? { "Content-Type": "application/json" } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const text = await response.text();
      const parsed = text ? safeJson(text) : {};
      if (!response.ok) throw new Error(`G마켓 ESM API HTTP ${response.status}: ${messageOf(parsed)}`);
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("G마켓 ESM API 요청 시간이 초과되었습니다.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function stateFrom(goodsNo: string, status: SellStatus): MarketState {
  return {
    market: "gmarket",
    externalId: goodsNo,
    price: status.gmktPrice,
    stock: status.gmktStock,
    saleStatus: status.gmktSell ? (status.gmktStock === 0 ? "OUT_OF_STOCK" : "ON_SALE") : "STOPPED"
  };
}

function masterGoodsNo(product: CatalogProduct): string {
  const value = (product.markets.gmarket?.productId ?? product.markets.gmarket?.externalId)?.trim();
  if (!value || !/^\d+$/.test(value)) throw new Error("G마켓 매핑에는 숫자형 마스터 상품번호(goodsNo)가 필요합니다.");
  return value;
}

function parseSellStatus(value: unknown): SellStatus {
  const root = objectValue(value);
  const isSell = objectValue(root.IsSell ?? root.isSell);
  const basic = objectValue(root.itemBasicInfo ?? root.ItemBasicInfo);
  const price = objectValue(basic.Price ?? basic.price);
  const stock = objectValue(basic.Stock ?? basic.stock);

  return {
    gmktSell: booleanValue(isSell.gmkt ?? isSell.Gmkt, "IsSell.gmkt"),
    iacSell: booleanValue(isSell.iac ?? isSell.Iac, "IsSell.iac"),
    gmktPrice: positiveNumber(price.gmkt ?? price.Gmkt, "Price.gmkt"),
    iacPrice: positiveNumber(price.iac ?? price.Iac, "Price.iac"),
    gmktStock: nonNegativeNumber(stock.gmkt ?? stock.Gmkt, "Stock.gmkt"),
    iacStock: nonNegativeNumber(stock.iac ?? stock.Iac, "Stock.iac")
  };
}

function assertSuccess(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("G마켓 ESM API 응답이 비어 있습니다.");
  const record = body as Record<string, unknown>;
  if (record.resultCode !== undefined && Number(record.resultCode) !== 0) {
    throw new Error(messageOf(body));
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`G마켓 응답 ${path} 형식이 올바르지 않습니다.`);
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`G마켓 응답 ${path} 값이 올바르지 않습니다.`);
  return number;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`G마켓 응답 ${path} 값이 올바르지 않습니다.`);
  return number;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("G마켓 ESM API가 JSON이 아닌 응답을 반환했습니다."); }
}

function messageOf(body: unknown): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  return "request failed";
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
