import { Bot, CheckCircle2, CircleSlash2, Send, Sparkles } from "lucide-react";
import type { CommandHistoryItem } from "../data";

type Props = {
  command: string;
  onCommandChange: (value: string) => void;
  onSubmit: () => void;
  history: CommandHistoryItem[];
  error: string | null;
};

const suggestions = [
  "홍옥 사과 5kg 전 마켓 품절",
  "머스크멜론 2수 가격 43900원",
  "제주 딱새우 1kg 재고 100개",
  "홍옥 사과 5kg 쿠팡 빼고 판매중지"
];

export function CommandPanel({ command, onCommandChange, onSubmit, history, error }: Props) {
  return (
    <aside className="command-rail">
      <section className="assistant-card">
        <div className="assistant-title"><div className="assistant-icon"><Bot size={19} /></div><div><strong>AI 판매 비서</strong><span>승인 후 실행</span></div></div>
        <div className="assistant-copy">
          <Sparkles size={18} />
          <div><strong>어떤 작업을 할까요?</strong><p>상품명, SKU, 마켓, 가격 또는 재고를 자연어로 입력하세요.</p></div>
        </div>
        <div className="suggestion-list">
          {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => onCommandChange(suggestion)}>{suggestion}</button>)}
        </div>
        <div className={error ? "command-input error" : "command-input"}>
          <textarea value={command} onChange={(event) => onCommandChange(event.target.value)} placeholder="예: 홍옥 사과 5kg 전부 품절시켜줘" rows={3} />
          <button type="button" onClick={onSubmit} aria-label="명령 검토"><Send size={18} /></button>
        </div>
        {error ? <p className="command-error">{error}</p> : <p className="command-help">실행 전에 변경 대상과 값을 반드시 다시 확인합니다.</p>}
      </section>

      <section className="history-card">
        <div className="history-heading"><strong>최근 명령</strong><button type="button">전체보기</button></div>
        <div className="history-list">
          {history.slice(0, 5).map((item) => (
            <article key={item.id}>
              <div className={`history-status ${item.status}`}>
                {item.status === "done" ? <CheckCircle2 size={15} /> : item.status === "cancelled" ? <CircleSlash2 size={15} /> : <Bot size={15} />}
              </div>
              <div><strong>{item.command}</strong><span>{item.status === "done" ? "실행 완료" : item.status === "cancelled" ? "사용자 취소" : "조회/검토"}</span></div>
              <time>{item.time}</time>
            </article>
          ))}
        </div>
      </section>

      <section className="telegram-card">
        <strong>텔레그램에서도 같은 방식으로</strong>
        <p>웹앱 계정에 Telegram Bot을 연결하면 동일한 승인 절차로 원격 제어할 수 있습니다.</p>
      </section>
    </aside>
  );
}
