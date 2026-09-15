import { createHmac } from "node:crypto";
import { hashSync } from "bcryptjs";
import { z } from "zod";
import type { Market } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import { coupangSignedDate } from "./coupangAdapter.js";

type FetchLike = typeof fetch;
type NaverCredentials = { clientId: string; clientSecret: string; accountId: string };
type CoupangCredentials = { accessKey: string; secretKey: string; vendorId: string };
type TossCredentials = { accessKey: string; secretKey: string };
type KakaoCredentials = { adminAppKey: string; sellerAppKey: string; channelIds: string };

const naverTokenSchema = z.object({ access_token: z.string().min(1) });
const tossTokenSchema = z.object({ access_token: z.string().min(1) });
const coupangProductListSchema = z.object({
  code: z.union([z.string(), z.number()]),
  message: z.string().optional(),
  nextToken: z.union([z.string(), z.number()]).nullable().optional(),
  data: z.array(z.object({
    sellerProductId: z.union([z.string(), z.number()]),
    sellerProductName: z.string().min(1),
    productId: z.union([z.string(), z.number()]).nullable().optional(),
    categoryId: z.union([z.string(), z.number()]).nullable().optional(),
    brand: z.string().nullable().optional(),
    statusName: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional()
  }).passthrough()).default([])
}).passthrough();
const tossProductListSchema = z.object({
  resultType: z.string(),
  error: z.object({
    errorCode: z.string().optional(),
    reason: z.string().optional()
  }).nullable().optional(),
  success: z.object({
    products: z.array(z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string().min(1),
      brandName: z.string().nullable().optional(),
      salePrice: z.coerce.number().nullable().optional(),
      inspectionStatus: z.string().nullable().optional(),
      exposureStatus: z.string().nullable().optional(),
      regTs: z.string().nullable().optional()
    }).passthrough()).default([]),
    nextToken: z.string().nullable().optional(),
    hasNext: z.boolean().optional()
  }).nullable().optional()
}).passthrough();

const moneySchema = z.object({
  units: z.coerce.number().nullable().optional()
}).passthrough().nullable().optional();
const coupangOrderListSchema = z.object({
  code: z.union([z.string(), z.number()]),
  message: z.string().optional(),
  nextToken: z.union([z.string(), z.number()]).nullable().optional(),
  data: z.array(z.object({
    shipmentBoxId: z.union([z.string(), z.number()]),
    orderId: z.union([z.string(), z.number()]),
    orderedAt: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    orderItems: z.array(z.object({
      sequenceNo: z.union([z.string(), z.number()]).nullable().optional(),
      productId: z.union([z.string(), z.number()]).nullable().optional(),
      vendorItemId: z.union([z.string(), z.number()]).nullable().optional(),
      vendorItemName: z.string().nullable().optional(),
      shippingCount: z.coerce.number().nullable().optional(),
      salesPrice: moneySchema,
      orderPrice: moneySchema,
      externalVendorSkuCode: z.string().nullable().optional(),
      sellerProductId: z.union([z.string(), z.number()]).nullable().optional(),
      sellerProductName: z.string().nullable().optional(),
      sellerProductItemName: z.string().nullable().optional(),
      canceled: z.boolean().optional()
    }).passthrough()).default([])
  }).passthrough()).default([])
}).passthrough();
const tossOrderListSchema = z.object({
  resultType: z.string(),
  error: z.object({
    errorCode: z.string().optional(),
    reason: z.string().optional()
  }).nullable().optional(),
  success: z.object({
    results: z.array(z.object({
      orderedAt: z.string().nullable().optional(),
      orderId: z.union([z.string(), z.number()]),
      orderProductId: z.union([z.string(), z.number()]),
      productId: z.union([z.string(), z.number()]).nullable().optional(),
      stockId: z.union([z.string(), z.number()]).nullable().optional(),
      productName: z.string().nullable().optional(),
      optionName: z.string().nullable().optional(),
      quantity: z.coerce.number().nullable().optional(),
      price: z.coerce.number().nullable().optional(),
      orderProductStatus: z.string().nullable().optional(),
      productManagementCode: z.string().nullable().optional(),
      productItemManagementCode: z.string().nullable().optional()
    }).passthrough()).default([]),
    nextCursor: z.string().nullable().optional()
  }).nullable().optional()
}).passthrough();

const COUPANG_ORDER_STATUSES = new Set(["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"]);
const TOSS_ORDER_STATUSES = new Set(["PAID", "CANCELED_PAYMENT", "PREPARING_PRODUCT", "DELIVERING", "DELIVERED", "CONFIRMED_ORDER"]);
const MAX_DISCOVERY_PAGES = 5;

export const REFERENCE_KINDS = ["categories", "shipping", "returns", "notices", "categoryMeta", "products", "orders"] as const;
export type MarketReferenceKind = (typeof REFERENCE_KINDS)[number];

export type MarketProductDiscoveryItem = {
  market: "coupang" | "toss";
  productId: string;
  providerProductId: string | null;
  name: string;
  brand: string | null;
  categoryId: string | null;
  status: string | null;
  price: number | null;
  registeredAt: string | null;
  controlMappingReady: false;
};

export type MarketProductDiscoveryPage = {
  items: MarketProductDiscoveryItem[];
  nextToken: string | null;
  hasNext: boolean;
  pagesFetched: number;
  controlMappingNote: string;
};

export type MarketOrderSummary = {
  market: "coupang" | "toss";
  orderId: string;
  orderLineId: string;
  shipmentId: string | null;
  listingId: string | null;
  controlId: string | null;
  productName: string;
  optionName: string | null;
  quantity: number | null;
  price: number | null;
  status: string;
  orderedAt: string | null;
  sellerSku: string | null;
};

export type MarketOrderDiscoveryPage = {
  items: MarketOrderSummary[];
  nextCursor: string | null;
  hasNext: boolean;
  pagesFetched: number;
  startDate: string;
  endDate: string;
  effectiveStatus: string | null;
  piiExcluded: true;
};

export class MarketReferenceService {
  constructor(
    private readonly credentials: EncryptedCredentialStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async get(
    tenantId: string,
    market: Market,
    kind: MarketReferenceKind,
    params: { categoryId?: string; keyword?: string } = {}
  ): Promise<unknown> {
    switch (market) {
      case "naver": return this.naver(tenantId, kind, params);
      case "coupang": return this.coupang(tenantId, kind, params);
      case "toss": return this.toss(tenantId, kind, params);
      case "kakao": return this.kakao(tenantId, kind, params);
      case "gmarket":
        if (kind === "orders") throw new Error("G마켓 주문 자동수집은 공식 셀링툴 주문 스펙 검증 후 활성화됩니다.");
        throw new Error("G마켓 참조데이터 자동조회는 공식 연동 스펙 검증 후 활성화됩니다.");
      case "lotteon":
        if (kind === "orders") throw new Error("롯데ON 주문 자동수집은 공식 주문 스펙 검증 후 활성화됩니다.");
        throw new Error("롯데ON 참조데이터 자동조회는 공식 연동 스펙 검증 후 활성화됩니다.");
    }
  }

  private async naver(tenantId: string, kind: MarketReferenceKind, params: { categoryId?: string }): Promise<unknown> {
    if (kind === "products") {
      throw new Error("네이버 기존상품 수집은 커머스솔루션 위임 accountUid 기반 조회가 검증되기 전까지 비활성화됩니다.");
    }
    if (kind === "orders") {
      throw new Error("네이버 주문 자동수집은 커머스솔루션 위임 주문 권한이 검증되기 전까지 비활성화됩니다.");
    }
    const token = await this.naverToken(tenantId);
    const headers = { Authorization: `Bearer ${token}` };
    if (kind === "categories") {
      return this.requestJson("https://api.commerce.naver.com/external/v1/categories", { headers }, "네이버 카테고리 조회");
    }
    if (kind === "shipping" || kind === "returns") {
      return this.requestJson("https://api.commerce.naver.com/external/v1/seller/addressbooks-for-page", { headers }, "네이버 판매자 주소록 조회");
    }
    if (kind === "notices") {
      const query = params.categoryId ? `?categoryId=${encodeURIComponent(params.categoryId)}` : "";
      return this.requestJson(`https://api.commerce.naver.com/external/v1/products-for-provided-notice${query}`, { headers }, "네이버 상품정보제공고시 조회");
    }
    if (!params.categoryId) throw new Error("카테고리 메타정보 조회에는 categoryId가 필요합니다.");
    return this.requestJson(`https://api.commerce.naver.com/external/v1/product-attributes/attributes?categoryId=${encodeURIComponent(params.categoryId)}`, { headers }, "네이버 카테고리 속성 조회");
  }

  private async coupang(
    tenantId: string,
    kind: MarketReferenceKind,
    params: { categoryId?: string; keyword?: string }
  ): Promise<unknown> {
    const credentials = this.required<CoupangCredentials>(tenantId, "coupang");
    if (kind === "orders") {
      const { startDate, endDate } = recentOrderWindow();
      const status = coupangOrderStatus(params.keyword);
      const path = `/v2/providers/openapi/apis/api/v5/vendors/${encodeURIComponent(credentials.vendorId)}/ordersheets`;
      const items = new Map<string, MarketOrderSummary>();
      const seenCursors = new Set<string>();
      let nextCursor: string | null = null;
      let pagesFetched = 0;

      do {
        const query = new URLSearchParams({
          createdAtFrom: `${startDate}+09:00`,
          createdAtTo: `${endDate}+09:00`,
          maxPerPage: "50",
          status
        });
        if (nextCursor) query.set("nextToken", nextCursor);
        const raw = await this.coupangRequest(tenantId, path, query.toString());
        const parsed = coupangOrderListSchema.parse(raw);
        if (!coupangResponseOk(parsed.code)) {
          throw new Error(`쿠팡 주문 조회 실패: ${parsed.message ?? "request failed"}`);
        }
        pagesFetched += 1;
        for (const shipment of parsed.data) {
          shipment.orderItems.forEach((item, index) => {
            const sequence = item.sequenceNo === null || item.sequenceNo === undefined
              ? item.vendorItemId === null || item.vendorItemId === undefined ? String(index + 1) : String(item.vendorItemId)
              : String(item.sequenceNo);
            const summary: MarketOrderSummary = {
              market: "coupang",
              orderId: String(shipment.orderId),
              orderLineId: `${String(shipment.shipmentBoxId)}:${sequence}`,
              shipmentId: String(shipment.shipmentBoxId),
              listingId: optionalId(item.sellerProductId),
              controlId: optionalId(item.vendorItemId),
              productName: item.sellerProductName?.trim() || item.vendorItemName?.trim() || "상품명 미확인",
              optionName: item.sellerProductItemName?.trim() || null,
              quantity: finiteOrNull(item.shippingCount),
              price: finiteOrNull(item.orderPrice?.units ?? item.salesPrice?.units),
              status: shipment.status?.trim() || "UNKNOWN",
              orderedAt: shipment.orderedAt?.trim() || null,
              sellerSku: item.externalVendorSkuCode?.trim() || null
            };
            items.set(summary.orderLineId, summary);
          });
        }
        nextCursor = normalizeCursor(parsed.nextToken);
        assertProgressingCursor(nextCursor, seenCursors, "쿠팡 주문");
      } while (nextCursor && pagesFetched < MAX_DISCOVERY_PAGES);

      return {
        items: [...items.values()],
        nextCursor,
        hasNext: Boolean(nextCursor),
        pagesFetched,
        startDate,
        endDate,
        effectiveStatus: status,
        piiExcluded: true
      } satisfies MarketOrderDiscoveryPage;
    }
    if (kind === "products") {
      const items = new Map<string, MarketProductDiscoveryItem>();
      const seenCursors = new Set<string>();
      let nextToken: string | null = null;
      let pagesFetched = 0;

      do {
        const query = new URLSearchParams({ vendorId: credentials.vendorId, maxPerPage: "100" });
        if (nextToken) query.set("nextToken", nextToken);
        const raw = await this.coupangRequest(tenantId, "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products", query.toString());
        const parsed = coupangProductListSchema.parse(raw);
        if (String(parsed.code).toUpperCase() !== "SUCCESS") {
          throw new Error(`쿠팡 기존상품 조회 실패: ${parsed.message ?? "request failed"}`);
        }
        pagesFetched += 1;
        for (const product of parsed.data) {
          const item: MarketProductDiscoveryItem = {
            market: "coupang",
            productId: String(product.sellerProductId),
            providerProductId: product.productId === null || product.productId === undefined ? null : String(product.productId),
            name: product.sellerProductName,
            brand: product.brand?.trim() || null,
            categoryId: product.categoryId === null || product.categoryId === undefined ? null : String(product.categoryId),
            status: product.statusName?.trim() || null,
            price: null,
            registeredAt: product.createdAt?.trim() || null,
            controlMappingReady: false
          };
          items.set(item.productId, item);
        }
        nextToken = normalizeCursor(parsed.nextToken);
        assertProgressingCursor(nextToken, seenCursors, "쿠팡 상품");
      } while (nextToken && pagesFetched < MAX_DISCOVERY_PAGES);

      return {
        items: [...items.values()],
        nextToken,
        hasNext: Boolean(nextToken),
        pagesFetched,
        controlMappingNote: "쿠팡 목록의 sellerProductId만으로 옵션별 재고·가격 제어를 실행하지 않습니다. vendorItemId 확인 후 별도 매핑이 필요합니다."
      } satisfies MarketProductDiscoveryPage;
    }
    if (kind === "categories") {
      return this.coupangRequest(tenantId, "/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories");
    }
    if (kind === "shipping") {
      return this.coupangRequest(tenantId, "/v2/providers/marketplace_openapi/apis/api/v2/vendor/shipping-place/outbound", "pageNum=1&pageSize=50");
    }
    if (kind === "returns") {
      return this.coupangRequest(tenantId, `/v2/providers/openapi/apis/api/v5/vendors/${encodeURIComponent(credentials.vendorId)}/returnShippingCenters`, "pageNum=1&pageSize=50");
    }
    if (!params.categoryId) throw new Error("쿠팡 카테고리 메타정보 조회에는 displayCategoryCode가 필요합니다.");
    return this.coupangRequest(tenantId, `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${encodeURIComponent(params.categoryId)}`);
  }

  private async toss(
    tenantId: string,
    kind: MarketReferenceKind,
    params: { categoryId?: string; keyword?: string }
  ): Promise<unknown> {
    const token = await this.tossToken(tenantId);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (kind === "orders") {
      const { startDate, endDate } = recentOrderWindow();
      const status = tossOrderStatus(params.keyword);
      const items = new Map<string, MarketOrderSummary>();
      const seenCursors = new Set<string>();
      let nextCursor: string | null = null;
      let pagesFetched = 0;

      do {
        const query = new URLSearchParams({
          startDate,
          endDate,
          limit: "50",
          partnerName: "SellerHub"
        });
        if (status) query.set("status", status);
        if (nextCursor) query.set("nextCursor", nextCursor);
        const raw = await this.requestJson(
          `https://shopping-fep.toss.im/api/v3/shopping-fep/orders/v2?${query.toString()}`,
          { headers },
          "토스쇼핑 주문 조회"
        );
        const parsed = tossOrderListSchema.parse(raw);
        if (parsed.resultType.toUpperCase() !== "SUCCESS" || !parsed.success) {
          throw new Error(`토스쇼핑 주문 조회 실패: ${parsed.error?.reason ?? parsed.error?.errorCode ?? "request failed"}`);
        }
        pagesFetched += 1;
        for (const item of parsed.success.results) {
          const summary: MarketOrderSummary = {
            market: "toss",
            orderId: String(item.orderId),
            orderLineId: String(item.orderProductId),
            shipmentId: null,
            listingId: optionalId(item.productId),
            controlId: null,
            productName: item.productName?.trim() || "상품명 미확인",
            optionName: item.optionName?.trim() || null,
            quantity: finiteOrNull(item.quantity),
            price: finiteOrNull(item.price),
            status: item.orderProductStatus?.trim() || status || "UNKNOWN",
            orderedAt: item.orderedAt?.trim() || null,
            sellerSku: item.productItemManagementCode?.trim() || item.productManagementCode?.trim() || null
          };
          items.set(summary.orderLineId, summary);
        }
        nextCursor = parsed.success.nextCursor?.trim() || null;
        assertProgressingCursor(nextCursor, seenCursors, "토스쇼핑 주문");
      } while (nextCursor && pagesFetched < MAX_DISCOVERY_PAGES);

      return {
        items: [...items.values()],
        nextCursor,
        hasNext: Boolean(nextCursor),
        pagesFetched,
        startDate,
        endDate,
        effectiveStatus: status,
        piiExcluded: true
      } satisfies MarketOrderDiscoveryPage;
    }
    if (kind === "products") {
      const items = new Map<string, MarketProductDiscoveryItem>();
      const seenCursors = new Set<string>();
      let nextToken: string | null = null;
      let hasNext = false;
      let pagesFetched = 0;

      do {
        const query = new URLSearchParams({ size: "50", partnerName: "SellerHub" });
        if (nextToken) query.set("nextToken", nextToken);
        const raw = await this.requestJson(
          `https://shopping-fep.toss.im/api/v3/shopping-fep/products/v2?${query.toString()}`,
          { headers },
          "토스쇼핑 기존상품 조회"
        );
        const parsed = tossProductListSchema.parse(raw);
        if (parsed.resultType.toUpperCase() !== "SUCCESS" || !parsed.success) {
          throw new Error(`토스쇼핑 기존상품 조회 실패: ${parsed.error?.reason ?? parsed.error?.errorCode ?? "request failed"}`);
        }
        pagesFetched += 1;
        for (const product of parsed.success.products) {
          const item: MarketProductDiscoveryItem = {
            market: "toss",
            productId: String(product.id),
            providerProductId: null,
            name: product.name,
            brand: product.brandName?.trim() || null,
            categoryId: null,
            status: product.exposureStatus?.trim() || product.inspectionStatus?.trim() || null,
            price: product.salePrice ?? null,
            registeredAt: product.regTs?.trim() || null,
            controlMappingReady: false
          };
          items.set(item.productId, item);
        }
        nextToken = parsed.success.nextToken?.trim() || null;
        hasNext = parsed.success.hasNext ?? Boolean(nextToken);
        if (!hasNext) nextToken = null;
        assertProgressingCursor(nextToken, seenCursors, "토스쇼핑 상품");
      } while (nextToken && pagesFetched < MAX_DISCOVERY_PAGES);

      return {
        items: [...items.values()],
        nextToken,
        hasNext: hasNext && Boolean(nextToken),
        pagesFetched,
        controlMappingNote: "토스 상품 목록의 productId만으로 옵션 재고·가격을 제어하지 않습니다. product-items 조회로 옵션 ID를 확인한 뒤 매핑해야 합니다."
      } satisfies MarketProductDiscoveryPage;
    }
    if (kind === "categories") {
      const query = params.categoryId ? `?id=${encodeURIComponent(params.categoryId)}` : "";
      return this.requestJson(`https://shopping-fep.toss.im/api/v3/shopping-fep/products/categories/children${query}`, { headers }, "토스쇼핑 카테고리 조회");
    }
    if (kind === "shipping") {
      return this.requestJson("https://shopping-fep.toss.im/api/v3/shopping-fep/merchants/group-delivery/delivery-location/v2?size=20", { headers }, "토스쇼핑 배송그룹 조회");
    }
    if (kind === "returns") {
      return this.requestJson("https://shopping-fep.toss.im/api/v3/shopping-fep/merchants/group-delivery/exchange-refund-location/v2?size=20", { headers }, "토스쇼핑 교환반품지 조회");
    }
    if (!params.categoryId) throw new Error("토스쇼핑 고시/카테고리 메타 조회에는 categoryId 또는 categoryCode가 필요합니다.");
    return this.requestJson(`https://shopping-fep.toss.im/api/v3/shopping-fep/notices?categoryCode=${encodeURIComponent(params.categoryId)}`, { headers }, "토스쇼핑 고시 조회");
  }

  private async kakao(tenantId: string, kind: MarketReferenceKind, params: { keyword?: string }): Promise<unknown> {
    if (kind === "products") {
      throw new Error("카카오 기존상품 자동수집은 연동대행사 운영 권한이 검증되기 전까지 비활성화됩니다.");
    }
    if (kind === "orders") {
      throw new Error("카카오 주문 자동수집은 연동대행사 주문 권한이 검증되기 전까지 비활성화됩니다.");
    }
    if (kind === "categories") {
      const path = params.keyword ? `/v1/store/categories/search?keyword=${encodeURIComponent(params.keyword)}` : "/v1/store/categories?leafOnly=true";
      return this.kakaoRequest(tenantId, path);
    }
    if (kind === "shipping" || kind === "returns") {
      return this.kakaoRequest(tenantId, "/v1/shopping/bizseller/seller-addresses/search?page=0");
    }
    throw new Error("카카오 톡스토어의 고시/카테고리 세부정보는 카테고리별 상품등록 스키마 단계에서 처리합니다.");
  }

  private required<T>(tenantId: string, market: Market): T {
    const value = this.credentials.get<T>(tenantId, market);
    if (!value) throw new Error(`${market} API 키가 저장되지 않았습니다.`);
    return value;
  }

  private async naverToken(tenantId: string): Promise<string> {
    const credentials = this.required<NaverCredentials>(tenantId, "naver");
    const timestamp = Date.now().toString();
    const hashed = hashSync(`${credentials.clientId}_${timestamp}`, credentials.clientSecret);
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
    return naverTokenSchema.parse(body).access_token;
  }

  private async coupangRequest(tenantId: string, path: string, query = ""): Promise<unknown> {
    const credentials = this.required<CoupangCredentials>(tenantId, "coupang");
    const method = "GET";
    const signedDate = coupangSignedDate(new Date());
    const signature = createHmac("sha256", credentials.secretKey).update(`${signedDate}${method}${path}${query}`).digest("hex");
    const authorization = `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;
    return this.requestJson(`https://api-gateway.coupang.com${path}${query ? `?${query}` : ""}`, {
      headers: { Authorization: authorization, "X-Requested-By": credentials.vendorId, "X-MARKET": "KR", Accept: "application/json" }
    }, "쿠팡 참조데이터 조회");
  }

  private async tossToken(tenantId: string): Promise<string> {
    const credentials = this.required<TossCredentials>(tenantId, "toss");
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
    return tossTokenSchema.parse(body).access_token;
  }

  private async kakaoRequest(tenantId: string, path: string): Promise<unknown> {
    const credentials = this.required<KakaoCredentials>(tenantId, "kakao");
    return this.requestJson(`https://kapi.kakao.com${path}`, {
      headers: {
        Authorization: `KakaoAK ${credentials.adminAppKey}`,
        "Target-Authorization": `KakaoAK ${credentials.sellerAppKey}`,
        "channel-ids": credentials.channelIds,
        Accept: "application/json"
      }
    }, "카카오쇼핑 참조데이터 조회");
  }

  private async requestJson(url: string, init: RequestInit, label: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let parsed: unknown = {};
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = { message: text.slice(0, 500) }; }
      }
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${messageOf(parsed)}`);
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${label} 요청 시간이 초과되었습니다.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function recentOrderWindow(): { startDate: string; endDate: string } {
  return { startDate: kstDate(-6), endDate: kstDate(0) };
}

function kstDate(dayOffset: number): string {
  const value = new Date(Date.now() + dayOffset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function coupangOrderStatus(raw: string | undefined): string {
  const value = raw?.trim().toUpperCase() || "ACCEPT";
  if (!COUPANG_ORDER_STATUSES.has(value)) {
    throw new Error(`쿠팡 주문 상태가 올바르지 않습니다: ${value}`);
  }
  return value;
}

function tossOrderStatus(raw: string | undefined): string | null {
  const value = raw?.trim().toUpperCase() || "";
  if (!value || value === "ALL") return null;
  if (!TOSS_ORDER_STATUSES.has(value)) {
    throw new Error(`토스쇼핑 주문 상태가 올바르지 않습니다: ${value}`);
  }
  return value;
}

function coupangResponseOk(code: string | number): boolean {
  return Number(code) === 200 || String(code).toUpperCase() === "SUCCESS";
}

function normalizeCursor(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function assertProgressingCursor(cursor: string | null, seen: Set<string>, label: string): void {
  if (!cursor) return;
  if (seen.has(cursor)) throw new Error(`${label} 페이지 커서가 반복되어 자동 수집을 중단했습니다.`);
  seen.add(cursor);
}

function optionalId(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  return "request failed";
}
