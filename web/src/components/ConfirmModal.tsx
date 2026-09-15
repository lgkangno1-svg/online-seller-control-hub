import { AlertTriangle, Check, X } from "lucide-react";
import type { ApiCommand, ApiMarketState, ApiPreview } from "../api";
import { formatWon, markets } from "../data";

type Props = {
  preview: ApiPreview | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({ preview, busy, onConfirm, onCancel }: Props) {
  if (!preview) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-icon warning"><AlertTriangle size={22} /></div>
        <h2 id="confirm-title">실행 전에 확인해 주세요</h2>
        <p className="modal-subtitle">이 화면에서 승인하기 전에는 어떤 마켓에도 쓰기 작업을 보내지 않습니다.</p>

        <div className="command-summary">
          <div><span>상품</span><strong>{preview.product.name}</strong><small>{preview.product.masterSku}</small></div>
          <div><span>작업</span><strong>{actionText(preview.command)}</strong><small>{new Date(preview.expiresAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지 승인</small></div>
        </div>

        <div className="impact-list">
          {preview.command.markets.map((marketId) => {
            const market = markets.find((item) => item.id === marketId);
            const state = preview.snapshot.find((item) => item.market === marketId);
            return (
              <div key={marketId}>
                <span className="impact-market"><i>{market?.short}</i>{market?.name}</span>
                <span className="impact-change"><del>{beforeValue(preview.command, state)}</del><b>→</b><strong>{afterValue(preview.command)}</strong></span>
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}><X size={17} />취소</button>
          <button type="button" className="primary" disabled={busy} onClick={onConfirm}><Check size={17} />{busy ? "실행 중..." : "승인하고 실행"}</button>
        </div>
      </section>
    </div>
  );
}

function actionText(command: ApiCommand): string {
  if (command.action === "SET_OUT_OF_STOCK") return "품절 처리";
  if (command.action === "SET_STOCK") return `재고 ${command.value ?? 0}개로 변경`;
  if (command.action === "SET_PRICE") return `판매가 ${formatWon(command.value)}`;
  if (command.action === "STOP_SALES") return "판매 중지";
  return "판매 재개";
}

function beforeValue(command: ApiCommand, state: ApiMarketState | undefined): string {
  if (!state) return "미확인";
  if (command.action === "SET_PRICE") return formatWon(state.price);
  if (command.action === "SET_STOCK" || command.action === "SET_OUT_OF_STOCK") return state.stock === null ? "미확인" : `${state.stock}개`;
  return saleStatusText(state.saleStatus);
}

function afterValue(command: ApiCommand): string {
  if (command.action === "SET_PRICE") return formatWon(command.value);
  if (command.action === "SET_STOCK") return `${command.value ?? 0}개`;
  if (command.action === "SET_OUT_OF_STOCK") return "0개";
  if (command.action === "STOP_SALES") return "판매중지";
  return "판매재개";
}

function saleStatusText(status: ApiMarketState["saleStatus"]): string {
  if (status === "ON_SALE") return "판매중";
  if (status === "STOPPED") return "판매중지";
  if (status === "OUT_OF_STOCK") return "품절";
  return "미확인";
}
