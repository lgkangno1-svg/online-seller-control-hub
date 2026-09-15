import type { MarketId } from "./data";

export type ApiCatalogProduct = {
  masterSku: string;
  name: string;
  aliases: string[];
  markets: MarketId[];
  marketMappings: Partial<Record<MarketId, string>>;
  marketProductIds: Partial<Record<MarketId, string>>;
};

export type ApiCatalogInput = {
  masterSku: string;
  name: string;
  aliases: string[];
  markets: Partial<Record<MarketId, { externalId?: string; productId?: string }>>;
};

export type ApiAccount = {
  userId: string;
  tenantId: string;
  email: string | null;
  username: string | null;
  role: "owner" | "member" | "admin";
  authKind: "account" | "legacy-beta";
  plan: "beta" | "free" | "pro";
  basePlan: "beta" | "free" | "pro";
  beta: boolean;
  billingEnabled: boolean;
  proUntil: string | null;
  checkoutMode: "disabled" | "test" | "live";
  webhookReady?: boolean;
  limits: { freeProductLimit: number; freeMarketLimit: number };
};

export type ApiSignupRequest = {
  userId: string;
  email: string;
  username?: string;
  status: "pending" | "active" | "rejected";
  createdAt: string;
  updatedAt: string;
};

export type ApiBillingStatus = {
  enabled: boolean;
  provider: "toss-payments";
  effectivePlan: "beta" | "free" | "pro";
  proUntil: string | null;
  price: number | null;
  proDays: number;
  checkoutMode: "disabled" | "test" | "live";
  freeProductLimit: number;
  freeMarketLimit: number;
};

export type ApiBillingCheckout = {
  orderId: string;
  checkoutUrl: string;
  amount: number;
  mode: "test" | "live";
};

export type ApiMarketConnection = {
  market: MarketId;
  configured: boolean;
  updatedAt: string | null;
};

export type ApiDelegatedMarketLink = {
  market: MarketId;
  linked: boolean;
  updatedAt: string | null;
};

export type ApiMarketConnections = {
  storageReady: boolean;
  publicEgressIp: string | null;
  connections: ApiMarketConnection[];
  delegatedLinks?: ApiDelegatedMarketLink[];
  naverSolutionReady?: boolean;
};

export type ApiNaverSolutionLinkResult = {
  market: "naver";
  linked: true;
  expiresAt: number;
};

export type ApiMarketConnectionCheck = {
  market: MarketId;
  ok: boolean;
  message: string;
  checkedAt: string;
  registrationSupported: boolean;
};

export type ApiRegistrationIssue = {
  level: "error" | "warning";
  path: string;
  message: string;
};

export type ApiRegistrationValidation = {
  market: MarketId;
  ok: boolean;
  errors: ApiRegistrationIssue[];
  warnings: ApiRegistrationIssue[];
};

export type ApiProductRegistrationResult = {
  market: MarketId;
  ok: boolean;
  message: string;
  externalId: string | null;
  controlExternalId?: string | null;
  cached?: boolean;
  validation?: ApiRegistrationValidation;
};

export type ApiMarketReferenceKind = "categories" | "shipping" | "returns" | "notices" | "categoryMeta" | "products" | "orders";
export type ApiMarketReference = {
  market: MarketId;
  kind: ApiMarketReferenceKind;
  data: unknown;
};

export type ApiMarketProductDiscoveryItem = {
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

export type ApiMarketProductDiscoveryPage = {
  items: ApiMarketProductDiscoveryItem[];
  nextToken: string | null;
  hasNext: boolean;
  controlMappingNote: string;
};

export type ApiMarketOrderSummary = {
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

export type ApiMarketOrderDiscoveryPage = {
  items: ApiMarketOrderSummary[];
  nextCursor: string | null;
  hasNext: boolean;
  startDate: string;
  endDate: string;
  effectiveStatus: string | null;
  piiExcluded: true;
};

export type ApiHealth = {
  ok: boolean;
  dryRun: boolean;
  productRegistrationEnabled: boolean;
};

export type MarketCredentialInput = Record<string, string>;

export type ApiCommand = {
  action: "SET_OUT_OF_STOCK" | "SET_STOCK" | "SET_PRICE" | "STOP_SALES" | "RESUME_SALES";
  productQuery: string;
  markets: MarketId[];
  value: number | null;
  rationale?: string;
};

export type ApiMarketState = {
  market: MarketId;
  externalId: string;
  price: number | null;
  stock: number | null;
  saleStatus: "ON_SALE" | "STOPPED" | "OUT_OF_STOCK" | "UNKNOWN";
};

export type ApiPreview = {
  approvalId: string;
  expiresAt: string;
  product: { name: string; masterSku: string };
  command: ApiCommand;
  snapshot: ApiMarketState[];
};

export type ApiExecutionResult = {
  market: MarketId;
  ok: boolean;
  message: string;
  before?: ApiMarketState;
  after?: ApiMarketState;
};

export type ApiActivityEntry = {
  at: string;
  type: "control_command" | "product_registration";
  actor: { kind: "web" | "telegram"; id: string };
  masterSku?: string;
  market?: MarketId;
  command?: ApiCommand;
  results?: ApiExecutionResult[];
  result?: ApiProductRegistrationResult;
  payloadSha256?: string;
};

export class SellerHubApi {
  constructor(private readonly token: string, private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? "") {}

  health(): Promise<ApiHealth> {
    return this.request<ApiHealth>("/api/health", {}, false);
  }

  account(): Promise<ApiAccount> {
    return this.request<ApiAccount>("/api/account");
  }

  async signupRequests(): Promise<ApiSignupRequest[]> {
    const response = await this.request<{ requests: ApiSignupRequest[] }>("/api/admin/signup-requests");
    return response.requests;
  }

  async approveSignup(userId: string): Promise<ApiSignupRequest> {
    const response = await this.request<{ request: ApiSignupRequest }>(`/api/admin/signup-requests/${encodeURIComponent(userId)}/approve`, { method: "POST" });
    return response.request;
  }

  async rejectSignup(userId: string): Promise<ApiSignupRequest> {
    const response = await this.request<{ request: ApiSignupRequest }>(`/api/admin/signup-requests/${encodeURIComponent(userId)}/reject`, { method: "POST" });
    return response.request;
  }

  billingStatus(): Promise<ApiBillingStatus> {
    return this.request<ApiBillingStatus>("/api/billing/status");
  }

  startBillingCheckout(): Promise<ApiBillingCheckout> {
    return this.request<ApiBillingCheckout>("/api/billing/checkout", { method: "POST" });
  }

  confirmBilling(paymentKey: string, orderId: string, amount: number): Promise<ApiBillingStatus> {
    return this.request<ApiBillingStatus>("/api/billing/confirm", {
      method: "POST",
      body: JSON.stringify({ paymentKey, orderId, amount })
    });
  }

  async activity(limit = 100): Promise<ApiActivityEntry[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const response = await this.request<{ entries: ApiActivityEntry[] }>(`/api/activity?limit=${safeLimit}`);
    return response.entries;
  }

  async catalog(): Promise<ApiCatalogProduct[]> {
    const response = await this.request<{ products: ApiCatalogProduct[] }>("/api/catalog");
    return response.products;
  }

  async saveProduct(input: ApiCatalogInput): Promise<ApiCatalogProduct> {
    const response = await this.request<{ product: ApiCatalogProduct }>("/api/catalog", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return response.product;
  }

  async deleteProduct(masterSku: string): Promise<void> {
    await this.request(`/api/catalog/${encodeURIComponent(masterSku)}`, { method: "DELETE" });
  }

  marketConnections(): Promise<ApiMarketConnections> {
    return this.request<ApiMarketConnections>("/api/markets/connections");
  }

  async saveMarketConnection(market: MarketId, credentials: MarketCredentialInput): Promise<void> {
    await this.request(`/api/markets/connections/${encodeURIComponent(market)}`, {
      method: "PUT",
      body: JSON.stringify(credentials)
    });
  }

  async deleteMarketConnection(market: MarketId): Promise<void> {
    await this.request(`/api/markets/connections/${encodeURIComponent(market)}`, { method: "DELETE" });
  }

  verifyMarketConnection(market: MarketId): Promise<ApiMarketConnectionCheck> {
    return this.request<ApiMarketConnectionCheck>(`/api/markets/connections/${encodeURIComponent(market)}/verify`, { method: "POST" });
  }

  linkNaverSolution(token: string): Promise<ApiNaverSolutionLinkResult> {
    return this.request<ApiNaverSolutionLinkResult>("/api/markets/naver/solution-link", {
      method: "POST",
      body: JSON.stringify({ token })
    });
  }

  async unlinkNaverSolution(): Promise<void> {
    await this.request("/api/markets/naver/solution-link", { method: "DELETE" });
  }

  marketReference(
    market: MarketId,
    kind: ApiMarketReferenceKind,
    params: { categoryId?: string; keyword?: string } = {}
  ): Promise<ApiMarketReference> {
    const query = new URLSearchParams();
    if (params.categoryId) query.set("categoryId", params.categoryId);
    if (params.keyword) query.set("keyword", params.keyword);
    return this.request<ApiMarketReference>(`/api/markets/${encodeURIComponent(market)}/references/${encodeURIComponent(kind)}${query.size ? `?${query}` : ""}`);
  }

  async discoverMarketProducts(market: "coupang" | "toss"): Promise<ApiMarketProductDiscoveryPage> {
    const response = await this.marketReference(market, "products");
    return response.data as ApiMarketProductDiscoveryPage;
  }

  async discoverMarketOrders(market: "coupang" | "toss", status?: string): Promise<ApiMarketOrderDiscoveryPage> {
    const response = await this.marketReference(market, "orders", status ? { keyword: status } : {});
    return response.data as ApiMarketOrderDiscoveryPage;
  }

  validateMarketProduct(market: MarketId, payload: Record<string, unknown>): Promise<ApiRegistrationValidation> {
    return this.request<ApiRegistrationValidation>(`/api/markets/${encodeURIComponent(market)}/products/validate`, {
      method: "POST",
      body: JSON.stringify({ payload })
    });
  }

  registerMarketProduct(
    market: MarketId,
    masterSku: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<ApiProductRegistrationResult> {
    return this.request<ApiProductRegistrationResult>(`/api/markets/${encodeURIComponent(market)}/products`, {
      method: "POST",
      body: JSON.stringify({ confirmed: true, masterSku, idempotencyKey, payload })
    });
  }

  preview(text: string): Promise<ApiPreview> {
    return this.request<ApiPreview>("/api/commands/preview", { method: "POST", body: JSON.stringify({ text }) });
  }

  async approve(approvalId: string): Promise<ApiExecutionResult[]> {
    const response = await this.request<{ results: ApiExecutionResult[] }>(`/api/commands/${encodeURIComponent(approvalId)}/approve`, { method: "POST" });
    return response.results;
  }

  async cancel(approvalId: string): Promise<void> {
    await this.request(`/api/commands/${encodeURIComponent(approvalId)}/cancel`, { method: "POST" });
  }

  async feedback(score: number, message: string, page = "dashboard"): Promise<void> {
    await this.request("/api/feedback", { method: "POST", body: JSON.stringify({ score, message, page }) });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init.headers
      }
    });

    const body = await response.json().catch(() => ({})) as {
      error?: string;
      message?: string;
      issues?: string[];
      verification?: { message?: string };
      validation?: ApiRegistrationValidation;
      code?: string;
    } & T;
    if (!response.ok) {
      const validationMessage = body.validation?.errors?.map((issue) => `${issue.path}: ${issue.message}`).join(" / ");
      const details = validationMessage
        ?? body.issues?.join(", ")
        ?? body.verification?.message
        ?? body.message
        ?? body.error
        ?? `HTTP ${response.status}`;
      throw new Error(details);
    }
    return body;
  }
}
