import { CheckCircle2, RefreshCw, UserCheck, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApiSignupRequest } from "../api";

type Props = {
  onList: () => Promise<ApiSignupRequest[]>;
  onApprove: (userId: string) => Promise<ApiSignupRequest>;
  onReject: (userId: string) => Promise<ApiSignupRequest>;
};

export function AdminSignupRequests({ onList, onApprove, onReject }: Props) {
  const [items, setItems] = useState<ApiSignupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await onList());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "가입 신청을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const act = async (item: ApiSignupRequest, action: "approve" | "reject") => {
    if (busyId) return;
    if (action === "reject" && !window.confirm(`${item.email} 가입 신청을 거절할까요?\n거절 후에는 이 계정으로 로그인할 수 없습니다.`)) return;

    setBusyId(item.userId);
    setError(null);
    setNotice(null);
    try {
      if (action === "approve") await onApprove(item.userId);
      else await onReject(item.userId);
      setItems((current) => current.filter((entry) => entry.userId !== item.userId));
      setNotice(`${item.email} 가입 신청을 ${action === "approve" ? "승인" : "거절"}했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "가입 신청 처리에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-signups">
      <div className="admin-signups-head">
        <div>
          <span className="eyebrow">ADMIN</span>
          <h2>가입 신청 관리</h2>
          <p>
            신청 정보를 확인한 뒤 승인된 계정만 SellerHub에 로그인할 수 있습니다.
            {!loading ? <strong className="admin-count"> 대기 {items.length}건</strong> : null}
          </p>
        </div>
        <button type="button" className="secondary-action" onClick={() => void reload()} disabled={loading || busyId !== null}>
          <RefreshCw size={16} /> 새로고침
        </button>
      </div>

      {error ? <div className="admin-error" role="alert">{error}</div> : null}
      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
      {loading ? <div className="admin-empty">가입 신청을 불러오는 중...</div> : null}
      {!loading && items.length === 0 ? (
        <div className="admin-empty">
          <CheckCircle2 size={28} />
          <strong>대기 중인 가입 신청이 없습니다.</strong>
        </div>
      ) : null}

      <div className="admin-signup-list">
        {items.map((item) => (
          <article key={item.userId} className="admin-signup-card">
            <div>
              <strong>{item.email}</strong>
              <span>신청일 {new Date(item.createdAt).toLocaleString("ko-KR")}</span>
              <small>{item.userId}</small>
            </div>
            <div className="admin-signup-actions">
              <button type="button" className="approve" disabled={busyId !== null} onClick={() => void act(item, "approve")}>
                <UserCheck size={16} /> {busyId === item.userId ? "처리 중..." : "승인"}
              </button>
              <button type="button" className="reject" disabled={busyId !== null} onClick={() => void act(item, "reject")}>
                <UserX size={16} /> {busyId === item.userId ? "처리 중..." : "거절"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
