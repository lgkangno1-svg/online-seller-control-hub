import { AlertTriangle, Boxes, PackageCheck, ShoppingCart, WalletCards } from "lucide-react";
import type { MarketId, Product } from "../data";
import { formatWon, markets } from "../data";

const marketClass: Record<MarketId, string> = {
  naver: "market-naver",
  coupang: "market-coupang",
  gmarket: "market-gmarket",
  lotteon: "market-lotte",
  toss: "market-toss",
  kakao: "market-kakao"
};

type Props = {
  products: Product[];
  selectedId: string | null;
  dryRun: boolean;
  onSelectProduct: (id: string) => void;
  onQuickCommand: (command: string) => void;
};

export function Dashboard({ products, selectedId, dryRun, onSelectProduct, onQuickCommand }: Props) {
  const soldOut = products.filter((product) => product.stock === 0).length;
  const selectedProduct = products.find((product) => product.id === selectedId) ?? null;

  return (
    <main className="dashboard-main">
      <section className="welcome-panel">
        <div>
          <h1>판매 운영을 한 곳에서 관리하세요.</h1>
          <p>상품·재고·가격 변경을 먼저 검토하고, 승인 후 원하는 마켓에만 반영합니다.</p>
        </div>
        <div className={dryRun ? "beta-state" : "beta-state live"}>{dryRun ? "베타 테스트 · DRY RUN" : "LIVE · 실제 변경 모드"}</div>
      </section>

      <section className="metric-grid" aria-label="핵심 지표">
        <article className="metric-card">
          <div className="metric-icon"><ShoppingCart size={20} /></div>
          <span>오늘 주문</span><strong>연동 예정</strong><small>주문 API 연결 단계</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><WalletCards size={20} /></div>
          <span>오늘 매출</span><strong>연동 예정</strong><small>주문 API 연결 후 집계</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon"><PackageCheck size={20} /></div>
          <span>마스터 상품</span><strong>{products.length.toLocaleString("ko-KR")}개</strong><small>현재 카탈로그 기준</small>
        </article>
        <article className="metric-card danger-card">
          <div className="metric-icon"><AlertTriangle size={20} /></div>
          <span>확인된 품절</span><strong>{soldOut}개</strong><small>상태 조회된 상품 기준</small>
        </article>
      </section>

      <section className="surface market-surface">
        <div className="section-heading">
          <div><h2>마켓 연동 상태</h2><p>현재 카탈로그에 매핑된 상품 수입니다.</p></div>
          <button type="button">연동 관리</button>
        </div>
        <div className="market-grid">
          {markets.map((market) => {
            const mappedCount = products.filter((product) => product.enabledMarkets.includes(market.id)).length;
            return (
              <article key={market.id} className="market-card">
                <div className={`market-logo ${marketClass[market.id]}`}>{market.short}</div>
                <div>
                  <strong>{market.name}</strong>
                  <span className={market.connected ? "connected" : "pending"}>{market.connected ? "연동 준비" : "승인 대기"}</span>
                  <small>{mappedCount.toLocaleString("ko-KR")}개 매핑</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="surface quick-surface">
        <div className="section-heading"><div><h2>빠른 작업</h2><p>{selectedProduct ? `${selectedProduct.name} 기준` : "상품을 먼저 선택하세요."}</p></div></div>
        <div className="quick-actions">
          <button type="button" disabled={!selectedProduct} onClick={() => selectedProduct && onQuickCommand(`${selectedProduct.name} 전 마켓 품절`)}>전 마켓 품절</button>
          <button type="button" disabled={!selectedProduct} onClick={() => selectedProduct && onQuickCommand(`${selectedProduct.name} 판매중지`)}>판매 중지</button>
          <button type="button" disabled={!selectedProduct} onClick={() => selectedProduct && onQuickCommand(`${selectedProduct.name} 판매재개`)}>판매 재개</button>
          <button type="button" disabled={!selectedProduct} onClick={() => selectedProduct && onQuickCommand(`${selectedProduct.name} 재고 10개`)}>재고 10개 예시</button>
        </div>
      </section>

      <section className="surface product-surface">
        <div className="section-heading">
          <div><h2>상품 카탈로그</h2><p>행을 선택하면 오른쪽 AI 명령 패널에 상품명이 자동 입력됩니다.</p></div>
          <button type="button">상품 관리</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>선택</th><th>상품명</th><th>SKU</th><th>판매가</th><th>재고</th><th>마켓</th><th>상태</th></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className={selectedId === product.id ? "selected-row" : ""} onClick={() => onSelectProduct(product.id)}>
                  <td><input type="radio" checked={selectedId === product.id} onChange={() => onSelectProduct(product.id)} aria-label={`${product.name} 선택`} /></td>
                  <td><div className="product-name"><div className="product-thumb"><Boxes size={17} /></div><strong>{product.name}</strong></div></td>
                  <td><code>{product.sku}</code></td>
                  <td>{formatWon(product.price)}</td>
                  <td className={product.stock === 0 ? "stock-zero" : ""}>{product.stock === null ? "미확인" : product.stock}</td>
                  <td><div className="mini-markets">{product.enabledMarkets.map((marketId) => <span key={marketId} className={marketClass[marketId]}>{markets.find((market) => market.id === marketId)?.short}</span>)}</div></td>
                  <td>{product.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
