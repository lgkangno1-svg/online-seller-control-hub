import { History, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { ApiCatalogProduct, ApiMarketOrderDiscoveryPage, ApiMarketOrderSummary } from "../api";

type OrderMarket = "coupang" | "toss";
type LoadMode = "live" | "cache";

const CACHED_ORDER_REFERENCE = "__SELLERHUB_CACHED_ORDERS__";

type Props = {
  products: ApiCatalogProduct[];
  onLoad: (market: OrderMarket, status?: string) => Promise<ApiMarketOrderDiscoveryPage>;
};

const coupangStatuses = [
  ["ACCEPT", "결제완료"],
  ["INSTRUCT", "상품준비중"],
  ["DEPARTURE", "배송지시"],
  ["DELIVERING", "배송중"],
  ["FINAL_DELIVERY", "배송완료"],
  ["NONE_TRACKING", "직접배송/추적불가"]
] as const;

const tossStatuses = [
  ["ALL", "전체"],
  ["PAID", "결제완료"],
  ["CANCELED_PAYMENT", "결제취소"],
  ["PREPARING_PRODUCT", "상품준비중"],
  ["DELIVERING", "배송중"],
  ["DELIVERED", "배송완료"],
  ["CONFIRMED_ORDER", "구매확정"]
] as const;

function formatDateTime(value: string | null): string {
  if (!value) return "주문시각 미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function mappedMasterSku(item: ApiMarketOrderSummary, products: ApiCatalogProduct[]): string | null {
  const matched = products.find((product) => {
    const productId = product.marketProductIds[item.market];
    const controlId = product.marketMappings[item.market];
    return Boolean(
      (item.listingId && productId === item.listingId)
      || (item.controlId && controlId === item.controlId)
    );
  });
  return matched?.masterSku ?? null;
}

export function OrderManager({ products, onLoad }: Props) {
  const [market, setMarket] = useState<OrderMarket>("coupang");
  const [status, setStatus] = useState("ACCEPT");
  const [page, setPage] = useState<ApiMarketOrderDiscoveryPage | null>(null);
  const [loadingMode, setLoadingMode] = useState<LoadMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statuses = market === "coupang" ? coupangStatuses : tossStatuses;
  const busy = loadingMode !== null;
  const cached = page?.effectiveStatus === CACHED_ORDER_REFERENCE;
  const mappedCount = useMemo(() => page?.items.filter((item) => mappedMasterSku(item, products)).length ?? 0, [page, products]);

  const changeMarket = (next: OrderMarket) => {
    setMarket(next);
    setStatus(next === "coupang" ? "ACCEPT" : "ALL");
    setPage(null);
    setError(null);
  };

  const load = async (mode: LoadMode) => {
    setLoadingMode(mode);
    setError(null);
    try {
      const requestedStatus = mode === "cache"
        ? CACHED_ORDER_REFERENCE
        : status === "ALL" ? undefined : status;
      setPage(await onLoad(market, requestedStatus));
    } catch (cause) {
      setPage(null);
      setError(cause instanceof Error ? cause.message : "주문을 불러오지 못했습니다.");
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <main className="manager-page">
      <div className="manager-header">
        <div>
          <h1>주문 관리</h1>
          <p>연결된 마켓의 최근 7일 주문을 읽기 전용으로 조회합니다. 발주·송장·상태 변경은 아직 실행하지 않습니다.</p>
        </div>
        <div className="manager-actions" style={{ gap: 8 }}>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void load("cache")}>
            <History size={16} /> {loadingMode === "cache" ? "저장본 조회 중..." : "저장된 주문 보기"}
          </button>
          <button type="button" className="primary-action" disabled={busy} onClick={() => void load("live")}>
            <RefreshCw size={16} /> {loadingMode === "live" ? "조회 중..." : "주문 새로고침"}
          </button>
        </div>
      </div>

      <section className="surface" style={{ marginBottom: 18 }}>
        <div className="manager-section-title">
          <div>
            <strong>조회 조건</strong>
            <span>마켓 공식 커서를 따라 최근 7일 주문을 최대 5페이지까지 자동 조회하고 중복을 제거합니다.</span>
          </div>
        </div>
        <div className="catalog-form-grid">
          <label>
            <span>마켓</span>
            <select value={market} onChange={(event) => changeMarket(event.target.value as OrderMarket)}>
              <option value="coupang">쿠팡</option>
              <option value="toss">토스쇼핑</option>
            </select>
          </label>
          <label>
            <span>주문 상태</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <p className="manager-help"><ShieldCheck size={14} style={{ verticalAlign: "-2px" }} /> 주문자·수취인 이름, 전화번호, 주소 등 개인정보는 서버에서 제거한 뒤 화면에 전달합니다.</p>
        {cached ? <p className="manager-help">현재 목록은 마지막 성공 조회 때 저장된 스냅샷입니다. 실시간 마켓 상태가 아니므로 최신 상태가 필요하면 주문 새로고침을 사용하세요.</p> : null}
        {error ? <p className="manager-error" role="alert">{error}</p> : null}
      </section>

      <section className="surface">
        <div className="manager-section-title">
          <div>
            <strong>주문 목록</strong>
            <span>{page
              ? cached
                ? `저장된 주문 · ${page.items.length}건 · Master SKU 매칭 ${mappedCount}건`
                : `${page.startDate} ~ ${page.endDate} · ${page.items.length}건 · Master SKU 매칭 ${mappedCount}건`
              : "아직 조회하지 않았습니다."}</span>
          </div>
        </div>

        {!page && !busy ? <div className="empty-manager">마켓과 상태를 선택한 뒤 주문 새로고침을 누르거나 저장된 주문을 확인하세요.</div> : null}
        {page?.items.length === 0 ? <div className="empty-manager">{cached ? "저장된 주문이 없습니다. 먼저 실시간 주문을 한 번 조회해 주세요." : "조건에 맞는 주문이 없습니다."}</div> : null}
        {page ? (
          <div className="catalog-list" style={{ maxHeight: "calc(100vh - 330px)", overflow: "auto" }}>
            {page.items.map((item) => {
              const masterSku = mappedMasterSku(item, products);
              return (
                <div className="catalog-list-item" key={`${item.market}-${item.orderLineId}`} style={{ cursor: "default" }}>
                  <strong>{item.productName}{item.optionName ? ` · ${item.optionName}` : ""}</strong>
                  <code>{item.market === "coupang" ? "쿠팡" : "토스"} 주문 {item.orderId} · {item.quantity ?? "?"}개{item.price !== null ? ` · ${item.price.toLocaleString("ko-KR")}원` : ""}</code>
                  <span>{item.status} · {formatDateTime(item.orderedAt)} · {masterSku ? `Master SKU ${masterSku}` : "Master SKU 미매핑"}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {!cached && page?.hasNext ? <p className="manager-help">아직 다음 주문 페이지가 있습니다. 한 번에 과도한 API 호출을 하지 않도록 이번 조회는 5페이지 안전 한도에서 멈췄습니다.</p> : null}
      </section>
    </main>
  );
}
