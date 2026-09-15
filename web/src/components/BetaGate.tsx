import { KeyRound, LockKeyhole, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { authConfig, loginAccount, registerAccount } from "../authApi";

type Props = {
  onLogin: (token: string) => Promise<void>;
};

type Mode = "login" | "register" | "legacy";

export function BetaGate({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [signupAvailable, setSignupAvailable] = useState(false);
  const [signupSubmitted, setSignupSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void authConfig().then((config) => setSignupAvailable(config.signupAvailable)).catch(() => setSignupAvailable(false));
  }, []);

  const submitAccount = async () => {
    setError(null);
    if (mode === "register") {
      if (!email.trim() || !password) {
        setError("이메일과 비밀번호를 입력해 주세요.");
        return;
      }
      setLoading(true);
      try {
        await registerAccount(email.trim(), password);
        setSignupSubmitted(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "가입 신청에 실패했습니다.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!identifier.trim() || !password) {
      setError("아이디 또는 이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      const session = await loginAccount(identifier.trim(), password);
      await onLogin(session.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const submitLegacy = async () => {
    if (!token.trim()) {
      setError("베타 초대 토큰을 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onLogin(token.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSignupSubmitted(false);
    setPassword("");
  };

  return (
    <main className="beta-gate">
      <section className="beta-gate-card commercial-login-card">
        <div className="beta-gate-logo">S</div>
        <h1>SellerHub</h1>
        <p>여러 오픈마켓의 상품·재고·가격을 한 곳에서 안전하게 관리합니다.</p>
        <div className="beta-security-note"><ShieldCheck size={18} /><span>API 키는 서버에 암호화 저장되며 모든 쓰기 명령은 실행 전에 확인합니다.</span></div>

        <div className="auth-tabs" role="tablist" aria-label="로그인 방식">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>로그인</button>
          {signupAvailable ? <button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>가입 신청</button> : null}
          <button type="button" className={mode === "legacy" ? "active" : ""} onClick={() => switchMode("legacy")}>베타 토큰</button>
        </div>

        {mode === "legacy" ? (
          <>
            <label htmlFor="beta-token">기존 베타 초대 토큰</label>
            <div className={error ? "beta-token-input error" : "beta-token-input"}>
              <KeyRound size={17} />
              <input
                id="beta-token"
                type="password"
                value={token}
                autoComplete="off"
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !loading) void submitLegacy(); }}
                placeholder="기존 테스터 토큰"
              />
            </div>
            {error ? <p className="beta-login-error">{error}</p> : null}
            <button type="button" className="beta-login-button" disabled={loading} onClick={() => void submitLegacy()}>
              {loading ? "확인 중..." : "기존 테스터 로그인"}
            </button>
          </>
        ) : mode === "register" ? (
          signupSubmitted ? (
            <div className="signup-pending-card">
              <UserPlus size={28} />
              <strong>가입 신청이 접수되었습니다.</strong>
              <p>관리자 승인 후 등록한 이메일과 비밀번호로 로그인할 수 있습니다.</p>
              <button type="button" className="beta-login-button" onClick={() => switchMode("login")}>로그인 화면으로</button>
            </div>
          ) : (
            <>
              <label htmlFor="seller-email">이메일</label>
              <div className={error ? "beta-token-input error" : "beta-token-input"}>
                <Mail size={17} />
                <input
                  id="seller-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seller@example.com"
                />
              </div>

              <label className="auth-field-label" htmlFor="seller-password">비밀번호</label>
              <div className={error ? "beta-token-input error" : "beta-token-input"}>
                <LockKeyhole size={17} />
                <input
                  id="seller-password"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !loading) void submitAccount(); }}
                  placeholder="영문+숫자 포함 10자 이상"
                />
              </div>
              {error ? <p className="beta-login-error">{error}</p> : null}
              <button type="button" className="beta-login-button" disabled={loading} onClick={() => void submitAccount()}>
                {loading ? "신청 중..." : "가입 신청하기"}
              </button>
              <small>가입 신청 후 관리자 승인 전에는 로그인할 수 없습니다.</small>
            </>
          )
        ) : (
          <>
            <label htmlFor="seller-identifier">아이디 또는 이메일</label>
            <div className={error ? "beta-token-input error" : "beta-token-input"}>
              <Mail size={17} />
              <input
                id="seller-identifier"
                type="text"
                value={identifier}
                autoComplete="username"
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="아이디 또는 seller@example.com"
              />
            </div>

            <label className="auth-field-label" htmlFor="seller-password">비밀번호</label>
            <div className={error ? "beta-token-input error" : "beta-token-input"}>
              <LockKeyhole size={17} />
              <input
                id="seller-password"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !loading) void submitAccount(); }}
                placeholder="비밀번호"
              />
            </div>
            {error ? <p className="beta-login-error">{error}</p> : null}
            <button type="button" className="beta-login-button" disabled={loading} onClick={() => void submitAccount()}>
              {loading ? "처리 중..." : "SellerHub 로그인"}
            </button>
            <small>관리자는 별도 아이디로 로그인할 수 있고, 일반 사용자는 승인된 이메일 계정을 사용합니다.</small>
          </>
        )}
      </section>
    </main>
  );
}
