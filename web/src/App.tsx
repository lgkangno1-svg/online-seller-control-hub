import { Bell, LogOut, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  SellerHubApi,
  type ApiAccount,
  type ApiActivityEntry,
  type ApiBillingStatus,
  type ApiCatalogInput,
  type ApiCatalogProduct,
  type ApiMarketConnectionCheck,
  type ApiMarketConnections,
  type ApiMarketOrderDiscoveryPage,
  type ApiMarketProductDiscoveryPage,
  type ApiMarketReference,
  type ApiMarketReferenceKind,
  type ApiPreview,
  type ApiProductRegistrationResult,
  type ApiRegistrationValidation,
  type ApiSignupRequest,
  type MarketCredentialInput
} from "./api";
import { ActivityLog } from "./components/ActivityLog";
import { AdminSignupRequests } from "./components/AdminSignupRequests";
import { BetaGate } from "./components/BetaGate";
import { BillingPage } from "./components/BillingPage";
import { CommandPanel } from "./components/CommandPanel";
import { ConfirmModal } from "./components/ConfirmModal";
import { Dashboard } from "./components/Dashboard";
import { FeedbackModal } from "./components/FeedbackModal";
import { MarketConnections } from "./components/MarketConnections";
import { OrderManager } from "./components/OrderManager";
import { ProductManager } from "./components/ProductManager";
import { ProductRegistration } from "./components/ProductRegistration";
import { Sidebar } from "./components/Sidebar";
import { type CommandHistoryItem, type MarketId, type Product } from "./data";

const SESSION_TOKEN_KEY = "sellerhub-beta-token";

function currentTime() {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

function mapCatalog(products: ApiCatalogProduct[]): Product[] {
  return products.map((product) => ({
    id: product.masterSku,
    name: product.name,
    sku: product.masterSku,
    price: null,
    stock: null,
    updatedAt: "상태 미조회",
    enabledMarkets: product.markets
  }));
}

function planLabel(account: ApiAccount | null) {
  if (!account) return "계정";
  if (account.role === "admin") return "ADMIN";
  if (account.plan === "beta") return "베타 테스터";
  if (account.plan === "pro") return "PRO";
  return "FREE";
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "");
  const [account, setAccount] = useState<ApiAccount | null>(null);
  const [billingStatus, setBillingStatus] = useState<ApiBillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [activeNav, setActiveNav] = useState("대시보드");
  const [catalogDetails, setCatalogDetails] = useState<ApiCatalogProduct[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [marketConnections, setMarketConnections] = useState<ApiMarketConnections | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [activity, setActivity] = useState<ApiActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ApiPreview | null>(null);
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [productRegistrationEnabled, setProductRegistrationEnabled] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(Boolean(token));
  const [commandBusy, setCommandBusy] = useState(false);
  const api = useMemo(() => token ? new SellerHubApi(token) : null, [token]);
  const selectedProduct = useMemo(() => products.find((product) => product.id === selectedId) ?? null, [products, selectedId]);

  const applyCatalog = (catalog: ApiCatalogProduct[], preferredId?: string | null) => {
    const mapped = mapCatalog(catalog);
    setCatalogDetails(catalog);
    setProducts(mapped);
    const preferredExists = preferredId && mapped.some((product) => product.id === preferredId);
    setSelectedId(preferredExists ? preferredId : mapped[0]?.id ?? null);
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    const client = new SellerHubApi(token);
    setSessionLoading(true);
    void Promise.all([client.catalog(), client.health(), client.account()])
      .then(([catalog, health, nextAccount]) => {
        if (!active) return;
        applyCatalog(catalog);
        setDryRun(health.dryRun);
        setProductRegistrationEnabled(health.productRegistrationEnabled);
        setAccount(nextAccount);
      })
      .catch(() => {
        if (!active) return;
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        setToken("");
        setAccount(null);
      })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const needsConnections = activeNav === "마켓 연동" || activeNav === "상품 등록";
    if (!needsConnections || !api || marketConnections || connectionsLoading) return;
    void loadConnections();
  }, [activeNav, api, marketConnections, connectionsLoading]);

  useEffect(() => {
    if (activeNav !== "활동 로그" || !api || activityLoading) return;
    void loadActivity();
  }, [activeNav, api]);

  useEffect(() => {
    if (activeNav !== "요금제" || !api || billingLoading) return;
    void loadBilling();
  }, [activeNav, api]);

  useEffect(() => {
    if (!api || !account || sessionLoading) return;
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    if (pathname === "/billing/fail") {
      setActiveNav("요금제");
      setToast(params.get("message") ? `결제가 완료되지 않았습니다: ${params.get("message")}` : "결제가 취소되거나 실패했습니다.");
      window.history.replaceState({}, "", "/");
      window.setTimeout(() => setToast(null), 6000);
      return;
    }

    if (pathname !== "/billing/success") return;
    const paymentKey = params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = Number(params.get("amount"));
    if (!paymentKey || !orderId || !Number.isInteger(amount) || amount <= 0) {
      setToast("결제 승인 정보가 올바르지 않습니다.");
      setActiveNav("요금제");
      window.history.replaceState({}, "", "/");
      return;
    }

    let active = true;
    setBillingLoading(true);
    void api.confirmBilling(paymentKey, orderId, amount)
      .then(async (status) => {
        if (!active) return;
        setBillingStatus(status);
        setAccount(await api.account());
        setActiveNav("요금제");
        setToast("결제가 승인되어 PRO 플랜이 활성화되었습니다.");
        window.history.replaceState({}, "", "/");
        window.setTimeout(() => setToast(null), 5200);
      })
      .catch((error) => {
        if (!active) return;
        setActiveNav("요금제");
        setToast(error instanceof Error ? `결제 승인 실패: ${error.message}` : "결제 승인에 실패했습니다.");
        window.history.replaceState({}, "", "/");
      })
      .finally(() => { if (active) setBillingLoading(false); });
    return () => { active = false; };
  }, [api, account, sessionLoading]);

  const handleLogin = async (nextToken: string) => {
    const client = new SellerHubApi(nextToken);
    const [catalog, health, nextAccount] = await Promise.all([client.catalog(), client.health(), client.account()]);
    sessionStorage.setItem(SESSION_TOKEN_KEY, nextToken);
    applyCatalog(catalog);
    setDryRun(health.dryRun);
    setProductRegistrationEnabled(health.productRegistrationEnabled);
    setAccount(nextAccount);
    setToken(nextToken);
    setSessionLoading(false);
  };

  const refreshCatalog = async (preferredId?: string | null) => {
    if (!api) return;
    const catalog = await api.catalog();
    applyCatalog(catalog, preferredId ?? selectedId);
  };

  const saveCatalogProduct = async (input: ApiCatalogInput) => {
    if (!api) throw new Error("세션이 없습니다.");
    await api.saveProduct(input);
    await refreshCatalog(input.masterSku);
    setToast("상품 매핑을 저장했습니다.");
    window.setTimeout(() => setToast(null), 2600);
  };

  const deleteCatalogProduct = async (masterSku: string) => {
    if (!api) throw new Error("세션이 없습니다.");
    await api.deleteProduct(masterSku);
    await refreshCatalog(null);
    setToast("SellerHub 상품 매핑을 삭제했습니다. 실제 마켓 상품은 변경되지 않았습니다.");
    window.setTimeout(() => setToast(null), 3600);
  };

  async function loadConnections() {
    if (!api) return;
    setConnectionsLoading(true);
    try {
      setMarketConnections(await api.marketConnections());
    } finally {
      setConnectionsLoading(false);
    }
  }

  async function loadActivity() {
    if (!api) return;
    setActivityLoading(true);
    setActivityError(null);
    try {
      setActivity(await api.activity(200));
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "활동 로그를 불러오지 못했습니다.");
    } finally {
      setActivityLoading(false);
    }
  }

  async function loadBilling() {
    if (!api) return;
    setBillingLoading(true);
    try {
      setBillingStatus(await api.billingStatus());
    } finally {
      setBillingLoading(false);
    }
  }

  const startBillingCheckout = async () => {
    if (!api || billingLoading) return;
    setBillingLoading(true);
    try {
      const checkout = await api.startBillingCheckout();
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "결제창을 열지 못했습니다.");
      setBillingLoading(false);
    }
  };

  const listSignupRequests = async (): Promise<ApiSignupRequest[]> => {
    if (!api) throw new Error("세션이 없습니다.");
    return api.signupRequests();
  };

  const approveSignup = async (userId: string): Promise<ApiSignupRequest> => {
    if (!api) throw new Error("세션이 없습니다.");
    const request = await api.approveSignup(userId);
    setToast(`${request.email} 가입을 승인했습니다.`);
    window.setTimeout(() => setToast(null), 3000);
    return request;
  };

  const rejectSignup = async (userId: string): Promise<ApiSignupRequest> => {
    if (!api) throw new Error("세션이 없습니다.");
    const request = await api.rejectSignup(userId);
    setToast(`${request.email} 가입 신청을 거절했습니다.`);
    window.setTimeout(() => setToast(null), 3000);
    return request;
  };

  const saveMarketConnection = async (market: MarketId, values: MarketCredentialInput) => {
    if (!api) throw new Error("세션이 없습니다.");
    await api.saveMarketConnection(market, values);
    await loadConnections();
    setToast("마켓 API 연동 정보를 암호화하여 저장했습니다.");
    window.setTimeout(() => setToast(null), 3000);
  };

  const deleteMarketConnection = async (market: MarketId) => {
    if (!api) throw new Error("세션이 없습니다.");
    await api.deleteMarketConnection(market);
    await loadConnections();
    setToast("마켓 API 연동 정보를 삭제했습니다.");
    window.setTimeout(() => setToast(null), 2600);
  };

  const verifyMarketConnection = async (market: MarketId): Promise<ApiMarketConnectionCheck> => {
    if (!api) throw new Error("세션이 없습니다.");
    const result = await api.verifyMarketConnection(market);
    if (result.ok) {
      setToast(`${market} API 연결 확인 성공`);
      window.setTimeout(() => setToast(null), 2200);
    }
    return result;
  };

  const loadMarketReference = async (
    market: MarketId,
    kind: ApiMarketReferenceKind,
    params?: { categoryId?: string; keyword?: string }
  ): Promise<ApiMarketReference> => {
    if (!api) throw new Error("세션이 없습니다.");
    return api.marketReference(market, kind, params);
  };

  const discoverMarketProducts = async (market: "coupang" | "toss"): Promise<ApiMarketProductDiscoveryPage> => {
    if (!api) throw new Error("세션이 없습니다.");
    return api.discoverMarketProducts(market);
  };

  const discoverMarketOrders = async (market: "coupang" | "toss", status?: string): Promise<ApiMarketOrderDiscoveryPage> => {
    if (!api) throw new Error("세션이 없습니다.");
    return api.discoverMarketOrders(market, status);
  };

  const validateMarketProduct = async (
    market: MarketId,
    payload: Record<string, unknown>
  ): Promise<ApiRegistrationValidation> => {
    if (!api) throw new Error("세션이 없습니다.");
    return api.validateMarketProduct(market, payload);
  };

  const registerMarketProduct = async (
    market: MarketId,
    masterSku: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<ApiProductRegistrationResult> => {
    if (!api) throw new Error("세션이 없습니다.");
    const result = await api.registerMarketProduct(market, masterSku, idempotencyKey, payload);
    if (result.ok) {
      await refreshCatalog(masterSku);
      setToast(`${market} 상품 등록 성공 · Master SKU 자동 연결 완료`);
      window.setTimeout(() => setToast(null), 3600);
      if (activeNav === "활동 로그") await loadActivity();
    }
    return result;
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setToken("");
    setAccount(null);
    setBillingStatus(null);
    setCatalogDetails([]);
    setProducts([]);
    setMarketConnections(null);
    setActivity([]);
    setActivityError(null);
    setSelectedId(null);
    setPreview(null);
    setHistory([]);
    setCommand("");
  };

  const fillQuickCommand = (value: string) => {
    setCommand(value);
    setCommandError(null);
  };

  const submitCommand = async () => {
    if (!api || commandBusy) return;
    if (!command.trim()) {
      setCommandError("명령을 입력해 주세요.");
      return;
    }
    setCommandBusy(true);
    setCommandError(null);
    try {
      const nextPreview = await api.preview(command.trim());
      setPreview(nextPreview);
      setSelectedId(nextPreview.product.masterSku);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "명령을 안전하게 해석하지 못했습니다.");
    } finally {
      setCommandBusy(false);
    }
  };

  const confirmCommand = async () => {
    if (!api || !preview || commandBusy) return;
    setCommandBusy(true);
    try {
      const results = await api.approve(preview.approvalId);
      const allOk = results.length > 0 && results.every((result) => result.ok);
      if (allOk) {
        setProducts((current) => current.map((product) => {
          if (product.sku !== preview.product.masterSku) return product;
          if (preview.command.action === "SET_OUT_OF_STOCK") return { ...product, stock: 0, updatedAt: "방금 실행" };
          if (preview.command.action === "SET_STOCK") return { ...product, stock: preview.command.value, updatedAt: "방금 실행" };
          if (preview.command.action === "SET_PRICE") return { ...product, price: preview.command.value, updatedAt: "방금 실행" };
          return { ...product, updatedAt: "방금 실행" };
        }));
      }
      setHistory((current) => [{ id: crypto.randomUUID(), command, status: "done", time: currentTime() }, ...current]);
      const successCount = results.filter((result) => result.ok).length;
      setToast(`${dryRun ? "DRY RUN" : "LIVE"} 실행 결과: ${successCount}/${results.length}개 마켓 성공`);
      setPreview(null);
      setCommand("");
      window.setTimeout(() => setToast(null), 4200);
      if (activeNav === "활동 로그") await loadActivity();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "실행에 실패했습니다.");
    } finally {
      setCommandBusy(false);
    }
  };

  const cancelCommand = async () => {
    if (!api || !preview || commandBusy) return;
    setCommandBusy(true);
    try {
      await api.cancel(preview.approvalId);
      setHistory((current) => [{ id: crypto.randomUUID(), command, status: "cancelled", time: currentTime() }, ...current]);
      setPreview(null);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "취소에 실패했습니다.");
      setPreview(null);
    } finally {
      setCommandBusy(false);
    }
  };

  const selectProduct = (id: string) => {
    setSelectedId(id);
    const product = products.find((item) => item.id === id);
    if (product) setCommand(`${product.name} `);
  };

  if (!token) return <BetaGate onLogin={handleLogin} />;
  if (sessionLoading) return <main className="session-loading"><div className="brand-mark">S</div><strong>SellerHub 불러오는 중...</strong></main>;

  const isDashboard = activeNav === "대시보드" || activeNav === "AI 명령";
  const accountLabel = account?.username ?? account?.email ?? account?.userId ?? "계정";

  return (
    <div className="app-shell">
      <Sidebar active={activeNav} admin={account?.role === "admin"} onSelect={setActiveNav} onFeedback={() => setFeedbackOpen(true)} />

      <div className="app-body">
        <header className="topbar">
          <label className="search-box">
            <Search size={18} />
            <input type="search" placeholder="상품명, SKU, 주문번호를 검색하세요..." />
          </label>
          <div className="topbar-actions">
            {account ? <span className="account-tenant" title={`tenant: ${account.tenantId}`}>{planLabel(account)}</span> : null}
            <button type="button" className="icon-button" aria-label="알림"><Bell size={18} /><i>3</i></button>
            <button type="button" className="profile-button" onClick={logout} title="로그아웃"><span><UserRound size={18} /></span><strong>{accountLabel}</strong><LogOut size={14} /></button>
          </div>
        </header>

        {isDashboard ? (
          <div className="workspace-grid">
            <Dashboard products={products} selectedId={selectedId} dryRun={dryRun} onSelectProduct={selectProduct} onQuickCommand={fillQuickCommand} />
            <CommandPanel command={command} onCommandChange={setCommand} onSubmit={() => void submitCommand()} history={history} error={commandError} />
          </div>
        ) : activeNav === "상품 관리" ? (
          <ProductManager products={catalogDetails} onSave={saveCatalogProduct} onDelete={deleteCatalogProduct} onDiscover={discoverMarketProducts} />
        ) : activeNav === "주문 관리" ? (
          <OrderManager products={catalogDetails} onLoad={discoverMarketOrders} />
        ) : activeNav === "상품 등록" ? (
          <ProductRegistration
            products={catalogDetails}
            connections={marketConnections}
            productRegistrationEnabled={productRegistrationEnabled}
            onLoadConnections={loadConnections}
            onVerify={verifyMarketConnection}
            onReference={loadMarketReference}
            onValidate={validateMarketProduct}
            onRegister={registerMarketProduct}
          />
        ) : activeNav === "마켓 연동" ? (
          <MarketConnections
            state={marketConnections}
            loading={connectionsLoading}
            onReload={loadConnections}
            onSave={saveMarketConnection}
            onDelete={deleteMarketConnection}
            onVerify={verifyMarketConnection}
          />
        ) : activeNav === "활동 로그" ? (
          <ActivityLog entries={activity} loading={activityLoading} error={activityError} onReload={loadActivity} />
        ) : activeNav === "요금제" ? (
          <BillingPage status={billingStatus} loading={billingLoading} onReload={loadBilling} onCheckout={startBillingCheckout} />
        ) : activeNav === "가입 승인" && account?.role === "admin" ? (
          <AdminSignupRequests onList={listSignupRequests} onApprove={approveSignup} onReject={rejectSignup} />
        ) : (
          <div className="route-placeholder">
            <strong>{activeNav}</strong>
            <span>이 기능을 순차적으로 실제 API와 연결하고 있습니다.</span>
            <button type="button" onClick={() => setActiveNav("대시보드")}>대시보드로 돌아가기</button>
          </div>
        )}
      </div>

      <ConfirmModal preview={preview} busy={commandBusy} onConfirm={() => void confirmCommand()} onCancel={() => void cancelCommand()} />
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSave={async (score, message) => {
          if (!api) throw new Error("세션이 없습니다.");
          await api.feedback(score, message, activeNav);
          setToast("피드백을 저장했습니다. 감사합니다.");
          window.setTimeout(() => setToast(null), 3600);
        }}
      />
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      <span className="selected-product-announcer" aria-live="polite">{selectedProduct ? `${selectedProduct.name} 선택됨` : ""}</span>
    </div>
  );
}
