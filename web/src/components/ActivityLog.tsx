import { AlertCircle, CheckCircle2, History, PackagePlus, RefreshCw, TerminalSquare } from "lucide-react";
import { useMemo } from "react";
import type { ApiActivityEntry } from "../api";
import { markets } from "../data";

type Props = {
  entries: ApiActivityEntry[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
};

const actionLabels: Record<string, string> = {
  SET_OUT_OF_STOCK: "품절 처리",
  SET_STOCK: "재고 변경",
  SET_PRICE: "가격 변경",
  STOP_SALES: "판매중지",
  RESUME_SALES: "판매재개"
};

export function ActivityLog({ entries, loading, error, onReload }: Props) {
  const totals = useMemo(() => {
    let success = 0;
    let failed = 0;
    for (const entry of entries) {
      if (entry.type === "product_registration") {
        entry.result?.ok ? success++ : failed++;
      } else {
        success += entry.results?.filter((item) => item.ok).length ?? 0;
        failed += entry.results?.filter((item) => !item.ok).length ?? 0;
      }
    }
    return { success, failed };
  }, [entries]);

  return (
    <main className="manager-page activity-page">
      <div className="manager-header">
        <div>
          <h1>활동 로그</h1>
          <p>상품 등록과 가격·재고·품절 명령의 실제 실행 이력을 현재 계정 범위에서 확인합니다.</p>
        </div>
        <button type="button" className="secondary-action" disabled={loading} onClick={() => void onReload()}>
          <RefreshCw size={15} /> {loading ? "불러오는 중" : "새로고침"}
        </button>
      </div>

      <section className="activity-summary">
        <div><History size={18} /><span>최근 기록</span><strong>{entries.length.toLocaleString("ko-KR")}</strong></div>
        <div><CheckCircle2 size={18} /><span>성공 처리</span><strong>{totals.success.toLocaleString("ko-KR")}</strong></div>
        <div><AlertCircle size={18} /><span>실패 처리</span><strong>{totals.failed.toLocaleString("ko-KR")}</strong></div>
      </section>

      {error ? <p className="manager-error" role="alert">{error}</p> : null}

      <section className="surface activity-list">
        {loading && entries.length === 0 ? <div className="activity-empty">활동 기록을 불러오는 중입니다.</div> : null}
        {!loading && entries.length === 0 ? <div className="activity-empty">아직 실행 기록이 없습니다.</div> : null}
        {entries.map((entry, index) => {
          const isRegistration = entry.type === "product_registration";
          const successful = isRegistration
            ? Boolean(entry.result?.ok)
            : Boolean(entry.results?.length && entry.results.every((item) => item.ok));
          const successCount = entry.results?.filter((item) => item.ok).length ?? 0;
          const failureCount = entry.results?.filter((item) => !item.ok).length ?? 0;
          const actor = entry.actor.kind === "telegram" ? "Telegram" : "Web";
          const marketLabel = entry.market ? markets.find((item) => item.id === entry.market)?.name ?? entry.market : null;
          const targetMarkets = entry.results?.map((item) => markets.find((market) => market.id === item.market)?.short ?? item.market).join(", ");
          return (
            <article className="activity-row" key={`${entry.at}-${entry.masterSku ?? "unknown"}-${index}`}>
              <div className={successful ? "activity-icon success" : "activity-icon fail"}>
                {isRegistration ? <PackagePlus size={16} /> : <TerminalSquare size={16} />}
              </div>
              <div className="activity-main">
                <div className="activity-title">
                  <strong>{isRegistration ? `${marketLabel ?? "마켓"} 상품 등록` : actionLabels[entry.command?.action ?? ""] ?? "상품 제어"}</strong>
                  <code>{entry.masterSku ?? "SKU 없음"}</code>
                </div>
                <p>
                  {isRegistration
                    ? entry.result?.message ?? "상품 등록 기록"
                    : `${targetMarkets || "대상 마켓 없음"} · 성공 ${successCount} / 실패 ${failureCount}`}
                </p>
                {entry.command?.value !== null && entry.command?.value !== undefined ? <span className="activity-value">값: {entry.command.value.toLocaleString("ko-KR")}</span> : null}
                {isRegistration && entry.result?.externalId ? <span className="activity-value">상품번호: {entry.result.externalId}</span> : null}
              </div>
              <div className="activity-meta">
                <strong>{successful ? "성공" : "확인 필요"}</strong>
                <span>{actor}</span>
                <time dateTime={entry.at}>{formatDate(entry.at)}</time>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
}
