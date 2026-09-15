import { MessageSquareText, X } from "lucide-react";
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (score: number, message: string) => Promise<void>;
};

export function FeedbackModal({ open, onClose, onSave }: Props) {
  const [score, setScore] = useState(5);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const saveFeedback = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(score, text.trim());
      setText("");
      setScore(5);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "피드백 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={saving ? undefined : onClose}>
      <section className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" disabled={saving} onClick={onClose} aria-label="닫기"><X size={18} /></button>
        <div className="modal-icon"><MessageSquareText size={22} /></div>
        <h2 id="feedback-title">베타 피드백</h2>
        <p className="modal-subtitle">불편한 점, 꼭 필요한 기능, 실제 판매 업무에서 막히는 부분을 알려주세요.</p>

        <label className="feedback-label">사용 만족도</label>
        <div className="score-row" role="radiogroup" aria-label="사용 만족도">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" disabled={saving} className={score === value ? "selected" : ""} onClick={() => setScore(value)}>{value}</button>
          ))}
        </div>

        <label className="feedback-label" htmlFor="feedback-text">의견</label>
        <textarea id="feedback-text" rows={6} disabled={saving} value={text} onChange={(event) => setText(event.target.value)} placeholder="예: 옵션 재고를 한 번에 바꾸는 기능이 필요해요." />
        {error ? <p className="command-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={saving} onClick={onClose}>나중에</button>
          <button type="button" className="primary" disabled={!text.trim() || saving} onClick={() => void saveFeedback()}>{saving ? "저장 중..." : "피드백 보내기"}</button>
        </div>
      </section>
    </div>
  );
}
