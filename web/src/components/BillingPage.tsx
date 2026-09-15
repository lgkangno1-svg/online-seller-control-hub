import { Check, CreditCard, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { ApiBillingStatus } from "../api";

type Props = {
  status: ApiBillingStatus | null;
  loading: boolean;
  onReload: () => Promise<void>;
  onCheckout: () => Promise<void>;
};

function money(value: number | null) {
  return value === null ? "결제 설정 전" : `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function date(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function BillingPage({ status, loading, onReload, onCheckout }: Props) {
  const isPro = status?.effectivePlan === "pro";
  const isBeta = status?.effectivePlan === "beta";

  return (
    <main className="manager-page billing-page">
      <div className="manager-header">
        <div>
          <h1>요금제</h1>
          <p>테스트가 끝난 뒤에도 같은 계정과 상품 매핑을 유지한 채 PRO로 전환할 수 있습니다.</p>
        </div>
        <button type="button" className="secondary-action" disabled={loading} onClick={() => void onReload()}>
          <RefreshCw size={15} /> 상태 새로고침
        </button>
      </div>

      <section className="billing-current surface">
        <div>
          <span className="billing-eyebrow">현재 플랜</span>
          <strong>{status?.effectivePlan === "pro" ? "PRO" : status?.effectivePlan === "beta" ? "BETA" : "FREE"}</strong>
          {isPro && status?.proUntil ? <p>PRO 이용기한: {date(status.proUntil)}</p> : null}
          {isBeta ? <p>베타 기간에는 PRO 수준으로 테스트하고, 종료 후 유료 전환할 수 있습니다.</p> : null}
        </div>
        <ShieldCheck size={30} />
      </section>

      <div className="billing-grid">
        <section className="billing-plan surface">
          <span className="billing-plan-tag">FREE</span>
          <h2>무료</h2>
          <strong className="billing-price">0원</strong>
          <ul>
            <li><Check size={16} /> Master SKU 최대 {status?.freeProductLimit ?? 20}개</li>
            <li><Check size={16} /> 마켓 최대 {status?.freeMarketLimit ?? 2}개 연결</li>
            <li><Check size={16} /> API 연결 확인·상품 매핑</li>
            <li><Check size={16} /> 텔레그램 승인 흐름 사용 가능</li>
          </ul>
        </section>

        <section className="billing-plan billing-pro surface">
          <div className="billing-pro-head">
            <span className="billing-plan-tag pro"><Sparkles size={13} /> PRO</span>
            {status?.checkoutMode === "test" ? <span className="billing-mode test">테스트 결제</span> : null}
            {status?.checkoutMode === "live" ? <span className="billing-mode live">실결제</span> : null}
          </div>
          <h2>SellerHub PRO</h2>
          <strong className="billing-price">{money(status?.price ?? null)}<small> / {status?.proDays ?? 30}일</small></strong>
          <ul>
            <li><Check size={16} /> Master SKU·6개 마켓 제한 해제</li>
            <li><Check size={16} /> 상품등록·재고·가격·판매상태 통합 제어</li>
            <li><Check size={16} /> Codex 자연어 명령 + 실행 전 승인</li>
            <li><Check size={16} /> 활동로그·중복등록 방지·안전검증</li>
          </ul>
          <button
            type="button"
            className="primary-action billing-pay-button"
            disabled={loading || !status?.enabled}
            onClick={() => void onCheckout()}
          >
            <CreditCard size={17} />
            {isPro ? "PRO 기간 연장" : status?.enabled ? "PRO 이용권 결제" : "결제 설정 필요"}
          </button>
          {!status?.enabled ? <p className="billing-help">운영 서버에 토스페이먼츠 키와 공개 도메인을 설정하면 결제가 활성화됩니다.</p> : null}
        </section>
      </div>

      <section className="billing-note surface">
        <strong>결제 안전장치</strong>
        <p>브라우저가 전달한 금액만으로 승인하지 않습니다. SellerHub가 서버에 저장한 주문 금액과 토스페이먼츠 승인 응답을 모두 대조한 경우에만 PRO 권한이 활성화됩니다.</p>
      </section>
    </main>
  );
}
