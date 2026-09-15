import { createHmac } from "node:crypto";
import type { Market } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import type { OrderSnapshotInput, OrderSnapshotStore } from "../persistence/orderSnapshotStore.js";
import { coupangSignedDate } from "./coupangAdapter.js";
import { CACHED_ORDER_REFERENCE } from "./orderCacheMarker.js";
import {
  MarketReferenceService,
  type MarketOrderDiscoveryPage,
  type MarketOrderSummary,
  type MarketReferenceKind
} from "./marketReferenceService.js";

const MAX_CACHED_ORDERS = 500;
const COUPANG_BASE_URL = "https://api-gateway.coupang.com";
const COUPANG_CATEGORY_PREDICT_PATH = "/v2/providers/openapi/apis/api/v1/categorization/predict";

type CoupangCredentials = { accessKey: string; secretKey: string; vendorId: string };

/**
 * Adds durable, PII-free order history and SellerHub convenience reads to the
 * underlying marketplace reference service. Provider writes are never added
 * here; these helpers remain read/recommendation-only.
 */
export class PersistingMarketReferenceService extends MarketReferenceService {
  constructor(
    private readonly credentialsStore: EncryptedCredentialStore,
    private readonly orderSnapshots: OrderSnapshotStore,
    private readonly providerFetch: typeof fetch = fetch
  ) {
    super(credentialsStore, providerFetch);
  }

  override async get(
    tenantId: string,
    market: Market,
    kind: MarketReferenceKind,
    params: { categoryId?: string; keyword?: string } = {}
  ): Promise<unknown> {
    if (kind === "orders" && params.keyword === CACHED_ORDER_REFERENCE) {
      return this.cachedOrders(tenantId, market);
    }

    if (market === "coupang" && kind === "categories" && params.keyword?.trim()) {
      return this.coupangCategoryRecommendation(tenantId, params.keyword.trim());
    }

    const result = await super.get(tenantId, market, kind, params);
    if (kind !== "orders") return result;

    const page = result as MarketOrderDiscoveryPage;
    if (!Array.isArray(page.items) || page.items.length === 0) return result;
    await this.orderSnapshots.merge(tenantId, page.items as OrderSnapshotInput[]);
    return result;
  }

  private async coupangCategoryRecommendation(tenantId: string, productName: string): Promise<unknown> {
    const credentials = this.credentialsStore.get<CoupangCredentials>(tenantId, "coupang");
    if (!credentials) throw new Error("쿠팡 카테고리 추천을 사용하려면 먼저 쿠팡 API 연동을 완료해 주세요.");
    if (productName.length > 300) throw new Error("쿠팡 카테고리 추천 상품명은 300자 이내로 입력해 주세요.");

    const method = "POST";
    const signedDate = coupangSignedDate(new Date());
    const signature = createHmac("sha256", credentials.secretKey)
      .update(`${signedDate}${method}${COUPANG_CATEGORY_PREDICT_PATH}`)
      .digest("hex");
    const authorization = `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await this.providerFetch(`${COUPANG_BASE_URL}${COUPANG_CATEGORY_PREDICT_PATH}`, {
        method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json;charset=UTF-8",
          "X-Requested-By": credentials.vendorId,
          "X-MARKET": "KR"
        },
        body: JSON.stringify({ productName }),
        signal: controller.signal
      });
      const text = await response.text();
      const body = parseJson(text);
      if (!response.ok) throw new Error(`쿠팡 카테고리 추천 요청이 실패했습니다. (HTTP ${response.status})`);
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("쿠팡 카테고리 추천 요청 시간이 초과되었습니다.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private cachedOrders(tenantId: string, market: Market): MarketOrderDiscoveryPage {
    if (market !== "coupang" && market !== "toss") {
      return emptyCachedPage();
    }

    const rows = this.orderSnapshots.list(tenantId, { market, limit: MAX_CACHED_ORDERS });
    const items: MarketOrderSummary[] = rows.map((row) => ({
      market,
      orderId: row.orderId,
      orderLineId: row.orderLineId,
      shipmentId: row.shipmentId,
      listingId: row.listingId,
      controlId: row.controlId,
      productName: row.productName,
      optionName: row.optionName,
      quantity: row.quantity,
      price: row.price,
      status: row.status,
      orderedAt: row.orderedAt,
      sellerSku: row.sellerSku
    }));
    const dates = rows
      .map((row) => row.orderedAt?.slice(0, 10) ?? "")
      .filter(Boolean)
      .sort();

    return {
      items,
      nextCursor: null,
      hasNext: false,
      pagesFetched: 0,
      startDate: dates[0] ?? "-",
      endDate: dates.length > 0 ? dates[dates.length - 1]! : "-",
      effectiveStatus: CACHED_ORDER_REFERENCE,
      piiExcluded: true
    };
  }
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("쿠팡 카테고리 추천 API가 올바르지 않은 응답을 반환했습니다.");
  }
}

function emptyCachedPage(): MarketOrderDiscoveryPage {
  return {
    items: [],
    nextCursor: null,
    hasNext: false,
    pagesFetched: 0,
    startDate: "-",
    endDate: "-",
    effectiveStatus: CACHED_ORDER_REFERENCE,
    piiExcluded: true
  };
}
