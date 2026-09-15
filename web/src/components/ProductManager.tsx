import { CloudDownload, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ApiCatalogInput, ApiCatalogProduct, ApiMarketProductDiscoveryItem, ApiMarketProductDiscoveryPage } from "../api";
import { markets, type MarketId } from "../data";

type MappingDraft = { productId: string; externalId: string };
type Draft = {
  masterSku: string;
  name: string;
  aliases: string;
  mappings: Partial<Record<MarketId, MappingDraft>>;
};
type DiscoveryMarket = "coupang" | "toss";

const emptyDraft: Draft = { masterSku: "", name: "", aliases: "", mappings: {} };

function fromProduct(product: ApiCatalogProduct): Draft {
  const mappings: Draft["mappings"] = {};
  for (const market of markets) {
    const productId = product.marketProductIds[market.id] ?? "";
    const externalId = product.marketMappings[market.id] ?? "";
    if (productId || externalId) mappings[market.id] = { productId, externalId };
  }
  return {
    masterSku: product.masterSku,
    name: product.name,
    aliases: product.aliases.join(", "),
    mappings
  };
}

function importedSku(item: ApiMarketProductDiscoveryItem): string {
  const prefix = item.market === "coupang" ? "CP" : "TOSS";
  return `${prefix}-${item.productId}`.slice(0, 120);
}

export function ProductManager({ products, onSave, onDelete, onDiscover }: {
  products: ApiCatalogProduct[];
  onSave: (input: ApiCatalogInput) => Promise<void>;
  onDelete: (masterSku: string) => Promise<void>;
  onDiscover: (market: DiscoveryMarket) => Promise<ApiMarketProductDiscoveryPage>;
}) {
  const [selectedSku, setSelectedSku] = useState<string | null>(products[0]?.masterSku ?? null);
  const [draft, setDraft] = useState<Draft>(() => products[0] ? fromProduct(products[0]) : { ...emptyDraft });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [discoveryMarket, setDiscoveryMarket] = useState<DiscoveryMarket>("coupang");
  const [discovery, setDiscovery] = useState<ApiMarketProductDiscoveryPage | null>(null);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const editing = useMemo(() => products.some((product) => product.masterSku === selectedSku), [products, selectedSku]);

  useEffect(() => {
    if (!selectedSku) return;
    const product = products.find((item) => item.masterSku === selectedSku);
    if (product) setDraft(fromProduct(product));
  }, [products, selectedSku]);

  const selectProduct = (product: ApiCatalogProduct) => {
    setSelectedSku(product.masterSku);
    setDraft(fromProduct(product));
    setError(null);
    setSaved(false);
  };

  const createNew = () => {
    setSelectedSku(null);
    setDraft({ ...emptyDraft, mappings: {} });
    setError(null);
    setSaved(false);
  };

  const setMapping = (market: MarketId, key: keyof MappingDraft, value: string) => {
    setDraft((current) => ({
      ...current,
      mappings: {
        ...current.mappings,
        [market]: {
          productId: current.mappings[market]?.productId ?? "",
          externalId: current.mappings[market]?.externalId ?? "",
          [key]: value
        }
      }
    }));
  };

  const discover = async (market: DiscoveryMarket) => {
    setDiscoveryMarket(market);
    setDiscoverBusy(true);
    setDiscovery(null);
    setError(null);
    try {
      setDiscovery(await onDiscover(market));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "마켓의 기존 상품을 불러오지 못했습니다.");
    } finally {
      setDiscoverBusy(false);
    }
  };

  const importCandidate = (item: ApiMarketProductDiscoveryItem) => {
    const masterSku = importedSku(item);
    const already = products.find((product) => product.marketProductIds[item.market] === item.productId);
    if (already) {
      selectProduct(already);
      setError(`${item.market === "coupang" ? "쿠팡" : "토스쇼핑"} 상품 ${item.productId}은(는) 이미 ${already.masterSku}에 연결되어 있습니다.`);
      return;
    }
    setSelectedSku(null);
    setDraft({
      masterSku,
      name: item.name,
      aliases: item.brand ? `${item.name}, ${item.brand}` : item.name,
      mappings: {
        [item.market]: {
          productId: item.productId,
          externalId: ""
        }
      }
    });
    setError(null);
    setSaved(false);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const save = async () => {
    const masterSku = draft.masterSku.trim();
    const name = draft.name.trim();
    if (!masterSku || !name) {
      setError("마스터 SKU와 상품명은 필수입니다.");
      return;
    }

    const mappedMarkets: ApiCatalogInput["markets"] = {};
    for (const market of markets) {
      const mapping = draft.mappings[market.id];
      const productId = mapping?.productId.trim() ?? "";
      const externalId = mapping?.externalId.trim() ?? "";
      if (!productId && !externalId) continue;
      mappedMarkets[market.id] = {
        ...(productId ? { productId } : {}),
        ...(externalId ? { externalId } : {})
      };
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({
        masterSku,
        name,
        aliases: draft.aliases.split(",").map((value) => value.trim()).filter(Boolean),
        markets: mappedMarkets
      });
      setSelectedSku(masterSku);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing || !selectedSku) return;
    if (!window.confirm("SellerHub에서 이 상품 매핑을 삭제할까요? 실제 오픈마켓 상품은 삭제되지 않습니다.")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selectedSku);
      const remaining = products.filter((product) => product.masterSku !== selectedSku);
      const next = remaining[0] ?? null;
      setSelectedSku(next?.masterSku ?? null);
      setDraft(next ? fromProduct(next) : { ...emptyDraft, mappings: {} });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상품 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="manager-page product-manager-page">
      <div className="manager-header">
        <div><h1>상품 관리</h1><p>Master SKU에 각 마켓의 상품 ID와 실제 가격·재고 제어 ID를 분리해 연결합니다.</p></div>
        <button type="button" className="primary-action" onClick={createNew}><Plus size={16} /> 새 상품</button>
      </div>

      <section className="surface" style={{ marginBottom: 18 }}>
        <div className="manager-section-title">
          <div><strong>기존 상품 가져오기</strong><span>공식 커서를 따라 최대 5페이지까지 읽기 전용으로 자동 조회합니다. 실제 마켓 상품은 변경하지 않습니다.</span></div>
        </div>
        <div className="manager-actions" style={{ justifyContent: "flex-start", gap: 8 }}>
          <button type="button" className={discoveryMarket === "coupang" ? "primary-action" : "secondary-action"} disabled={discoverBusy} onClick={() => void discover("coupang")}><CloudDownload size={15} /> 쿠팡에서 불러오기</button>
          <button type="button" className={discoveryMarket === "toss" ? "primary-action" : "secondary-action"} disabled={discoverBusy} onClick={() => void discover("toss")}><CloudDownload size={15} /> 토스쇼핑에서 불러오기</button>
        </div>
        {discoverBusy ? <p className="manager-help">기존 상품을 안전하게 조회하고 있습니다...</p> : null}
        {discovery ? (
          <div className="catalog-list" style={{ marginTop: 12, maxHeight: 320, overflow: "auto" }}>
            {discovery.items.length === 0 ? <div className="empty-manager">조회된 상품이 없습니다.</div> : null}
            {discovery.items.map((item) => (
              <button type="button" className="catalog-list-item" key={`${item.market}-${item.productId}`} onClick={() => importCandidate(item)}>
                <strong>{item.name}</strong>
                <code>{item.market === "coupang" ? "쿠팡" : "토스"} · {item.productId}</code>
                <span>{item.status ?? "상태 미확인"}{item.price !== null ? ` · ${item.price.toLocaleString("ko-KR")}원` : ""} · 클릭해 초안 만들기</span>
              </button>
            ))}
            <p className="manager-help">{discovery.items.length.toLocaleString("ko-KR")}개 상품을 중복 제거해 불러왔습니다. {discovery.controlMappingNote}</p>
            {discovery.hasNext ? <p className="manager-help">아직 다음 페이지가 있습니다. 한 번에 과도한 API 호출을 하지 않도록 이번 조회는 5페이지 안전 한도에서 멈췄습니다.</p> : null}
          </div>
        ) : null}
      </section>

      <div className="product-manager-grid">
        <section className="surface catalog-list-panel">
          <div className="manager-section-title"><strong>마스터 상품</strong><span>{products.length.toLocaleString("ko-KR")}개</span></div>
          <div className="catalog-list">
            {products.length === 0 ? <div className="empty-manager">등록된 상품이 없습니다.</div> : null}
            {products.map((product) => (
              <button type="button" key={product.masterSku} className={selectedSku === product.masterSku ? "catalog-list-item active" : "catalog-list-item"} onClick={() => selectProduct(product)}>
                <strong>{product.name}</strong><code>{product.masterSku}</code><span>{product.markets.length}개 마켓 매핑</span>
              </button>
            ))}
          </div>
        </section>

        <section className="surface catalog-editor-panel">
          <div className="manager-section-title"><div><strong>{editing ? "상품 매핑 수정" : "새 마스터 상품"}</strong><span>이 화면의 저장은 SellerHub 내부 매핑만 수정합니다.</span></div></div>
          <div className="catalog-form-grid">
            <label><span>마스터 SKU *</span><input value={draft.masterSku} disabled={editing} onChange={(event) => setDraft((current) => ({ ...current, masterSku: event.target.value }))} placeholder="예: APPLE-HONGOK-5KG" /></label>
            <label><span>상품명 *</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="예: 홍옥 사과 5kg" /></label>
            <label className="full-field"><span>검색 별칭</span><input value={draft.aliases} onChange={(event) => setDraft((current) => ({ ...current, aliases: event.target.value }))} placeholder="쉼표로 구분: 홍옥5kg, 홍옥 사과, 가을 사과" /></label>
          </div>

          <div className="mapping-heading"><strong>오픈마켓 ID 매핑</strong><p>상품 ID는 등록 이력용, 제어 ID는 가격·재고·품절 명령용입니다. 쿠팡은 제어 ID에 vendorItemId를 입력합니다.</p></div>
          <div className="market-mapping-grid dual-id-grid">
            {markets.map((market) => {
              const mapping = draft.mappings[market.id] ?? { productId: "", externalId: "" };
              return (
                <div className="market-mapping-card" key={market.id}>
                  <div className="mapping-market-name"><b>{market.short}</b><strong>{market.name}</strong></div>
                  <label><span>상품 ID</span><input value={mapping.productId} onChange={(event) => setMapping(market.id, "productId", event.target.value)} placeholder={`${market.name} 상품 ID`} /></label>
                  <label><span>제어 ID</span><input value={mapping.externalId} onChange={(event) => setMapping(market.id, "externalId", event.target.value)} placeholder={market.id === "coupang" ? "vendorItemId" : market.id === "toss" ? "옵션/Item ID" : "가격·재고 제어용 ID"} /></label>
                </div>
              );
            })}
          </div>

          {error ? <p className="manager-error" role="alert">{error}</p> : null}
          {saved ? <p className="manager-success" role="status">저장했습니다.</p> : null}
          <div className="manager-actions">
            {editing ? <button type="button" className="danger-action" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> 매핑 삭제</button> : <span />}
            <button type="button" className="primary-action" disabled={busy} onClick={() => void save()}><Save size={15} /> {busy ? "저장 중..." : "저장"}</button>
          </div>
        </section>
      </div>
    </main>
  );
}
