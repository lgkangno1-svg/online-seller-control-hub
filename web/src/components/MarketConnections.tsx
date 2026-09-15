import {
  CheckCircle2,
  CircleAlert,
  Clipboard,
  ExternalLink,
  KeyRound,
  Link2,
  PlugZap,
  Save,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ApiMarketConnectionCheck, ApiMarketConnections, MarketCredentialInput } from "../api";
import { markets, type MarketId } from "../data";

type Field = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder: string;
  hint?: string;
};

type MarketSpec = {
  title: string;
  note: string;
  connectionMode: string;
  customerFlow: string;
  operatorNote?: string;
  adminTestOnly?: boolean;
  commercialBlocked?: boolean;
  fields: Field[];
  needsIp?: boolean;
  approvalNote?: string;
  policyNote?: string;
  helpUrl: string;
  steps: string[];
  troubleshooting: string[];
};

const specs: Record<MarketId, MarketSpec> = {
  naver: {
    title: "네이버 스마트스토어",
    note: "상용 SellerHub에서는 판매자가 Client ID/Secret을 만들지 않는 커머스솔루션 연결 방식으로 운영합니다.",
    connectionMode: "자동 연결형",
    customerFlow: "일반 이용자: 커머스솔루션마켓에서 SellerHub를 구독하고 [사용하기]로 들어오면 네이버가 전달한 판매자 식별정보를 검증해 자동 연결합니다.",
    operatorNote: "현재 입력칸은 운영자 본인 스토어의 SELF 연결을 검증하기 위한 관리자 테스트 전용입니다. 상용 판매자에게 이 키를 요구하지 않습니다.",
    adminTestOnly: true,
    commercialBlocked: true,
    fields: [
      { key: "clientId", label: "관리자 테스트 Client ID", placeholder: "내 스토어 애플리케이션 ID", hint: "관리자 SELF 검증 전용" },
      { key: "clientSecret", label: "관리자 테스트 Client Secret", secret: true, placeholder: "재발급한 Client Secret", hint: "채팅이나 문서에 붙이지 말고 이 입력칸에만 직접 입력하세요" }
    ],
    approvalNote: "상용 연동은 네이버 커머스솔루션 JWT의 서명·만료시간·solutionId를 검증한 뒤 accountUid를 안전하게 매핑하는 구조로 전환합니다.",
    policyNote: "커머스솔루션 등록/심사가 완료되기 전에는 네이버 실상품 쓰기를 강제로 차단합니다.",
    helpUrl: "https://apicenter.commerce.naver.com/docs/solution-doc/3000/%EC%86%94%EB%A3%A8%EC%85%98-%EA%B5%AC%EB%8F%85-%EC%97%B0%EB%8F%99-%ED%94%84%EB%A1%9C%EC%84%B8%EC%8A%A4",
    steps: [
      "일반 판매자는 네이버 커머스솔루션마켓에서 SellerHub를 구독합니다.",
      "[사용하기]로 SellerHub에 진입하면 네이버가 짧은 수명의 서명된 JWT를 전달합니다.",
      "SellerHub가 JWT를 검증하고 accountUid를 판매자 계정에 매핑합니다.",
      "현재는 솔루션 등록 전이므로 운영자 SELF 연결 확인만 사용할 수 있습니다."
    ],
    troubleshooting: [
      "관리자 SELF 테스트 401이면 Client ID와 새 Client Secret이 같은 애플리케이션의 값인지 확인하세요.",
      "403이면 애플리케이션 상태와 판매자정보 API 그룹 권한을 확인하세요.",
      "일반 이용자에게 Client Secret 또는 네이버 비밀번호를 요청하면 안 됩니다."
    ]
  },
  coupang: {
    title: "쿠팡",
    note: "쿠팡 공식 Open API는 현재 판매자가 WING에서 발급한 키를 1회 등록하는 방식입니다.",
    connectionMode: "키 1회 등록형",
    customerFlow: "일반 이용자: WING에서 업체코드, Access Key, Secret Key를 한 번 발급해 SellerHub에 저장합니다. 이후 재로그인할 때마다 다시 입력하지 않습니다.",
    fields: [
      { key: "accessKey", label: "Access Key", placeholder: "Access Key", hint: "WING OPEN API 키 발급 화면" },
      { key: "secretKey", label: "Secret Key", secret: true, placeholder: "Secret Key", hint: "암호화 저장되며 저장 후 다시 표시하지 않습니다" },
      { key: "vendorId", label: "Vendor ID", placeholder: "예: A00012345", hint: "WING 화면의 업체코드" }
    ],
    policyNote: "공식 문서에서 판매자 위임 OAuth/로그인 연결을 제공하지 않으므로 가짜 로그인 연동을 만들지 않습니다.",
    helpUrl: "https://developers.coupangcorp.com/hc/ko/articles/360022939194",
    steps: [
      "WING 로그인 → 우측 상단 아이디 → 판매자정보/추가판매정보로 이동합니다.",
      "OPEN API 키 발급 약관에 동의하고 OPEN API를 선택해 발급합니다.",
      "업체코드(Vendor ID), Access Key, Secret Key를 복사합니다.",
      "세 값을 한 번 저장한 뒤 연결 확인을 실행합니다."
    ],
    troubleshooting: [
      "401/Signature 오류면 Access Key와 Secret Key가 한 쌍인지 확인하세요.",
      "업체코드는 판매자 ID가 아니라 WING에 표시되는 Vendor ID를 입력해야 합니다.",
      "키를 재발급했다면 SellerHub의 저장값도 새 키로 교체해야 합니다."
    ]
  },
  gmarket: {
    title: "G마켓 / ESM",
    note: "상용 셀링툴 구조에서는 SellerHub가 운영자 Master ID/Secret을 보유하고 이용자는 자신의 판매자 ID만 연결합니다.",
    connectionMode: "셀링툴 매핑형",
    customerFlow: "일반 이용자: SellerHub의 ESM 셀링툴 승인이 끝나면 G마켓 판매자 ID만 입력해 매핑합니다. 이용자에게 SellerHub 운영자 Secret을 요구하지 않습니다.",
    operatorNote: "현재 SellerHub 사업자 명의의 ESM Trading API 셀링툴 승인과 운영 실사용 협의가 완료되어야 자동 연결이 열립니다.",
    commercialBlocked: true,
    fields: [
      { key: "gmarketSellerId", label: "G마켓 판매자 ID", placeholder: "G마켓 Seller ID", hint: "SellerHub 운영자 Master ID/Secret은 서버에서 별도로 관리합니다" }
    ],
    approvalNote: "ESM 문서상 셀링툴사의 JWT kid는 셀링툴사 Master ID를 사용하고 ssi에 대상 판매자 ID를 넣습니다.",
    policyNote: "운영 승인 전에는 G마켓 LIVE 가격·재고·판매상태 쓰기를 강제로 차단합니다.",
    helpUrl: "https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C",
    steps: [
      "SellerHub 운영자가 사업자 명의로 ESM Trading API 셀링툴 승인을 완료합니다.",
      "이용자는 자신의 G마켓 판매자 ID만 SellerHub에 입력합니다.",
      "SellerHub 서버가 운영자 Secret으로 JWT를 만들고 해당 판매자 ID를 ssi에 매핑합니다.",
      "운영 승인 전에는 연결 확인/실상품 쓰기를 열지 않습니다."
    ],
    troubleshooting: [
      "'운영자 설정 필요'가 나오면 이용자 문제가 아니라 SellerHub의 셀링툴 승인이 아직 끝나지 않은 상태입니다.",
      "판매자 ID가 실제 G마켓 계정과 일치하는지 확인하세요.",
      "SellerHub 운영자 Master ID나 Secret Key를 이용자에게 요청하지 않습니다."
    ]
  },
  lotteon: {
    title: "롯데ON",
    note: "현재 확인된 판매자 OpenAPI 키 방식은 유지하되, 상용 솔루션사 위임 절차가 공식 확인되기 전에는 자동 연결을 열지 않습니다.",
    connectionMode: "정책 확인 중",
    customerFlow: "일반 이용자: 공식 솔루션사/대행사 위임 방식이 확인될 때까지 기존 판매자 API 인증키 방식만 보수적으로 지원합니다.",
    commercialBlocked: true,
    fields: [
      { key: "apiKey", label: "API 인증키", secret: true, placeholder: "롯데ON API 인증키", hint: "판매자센터 OpenAPI 관리에서 발급한 키" }
    ],
    needsIp: true,
    approvalNote: "정확한 상용 위임 정책을 확인하기 전에는 로그인처럼 보이는 임의 연동을 만들지 않습니다.",
    policyNote: "롯데ON 실상품 쓰기는 현재 LIVE 대상에서 제외되어 있습니다.",
    helpUrl: "https://seller.lotteon.com/",
    steps: [
      "롯데ON 판매자센터의 최신 OpenAPI 메뉴와 계약 조건을 확인합니다.",
      "필요한 경우 SellerHub 서버 출구 IP를 허용 IP로 등록합니다.",
      "현재 테스트는 판매자 API 인증키를 암호화 저장해 연결 확인만 수행합니다.",
      "상용 위임 절차 검증이 끝나기 전에는 실상품 쓰기를 활성화하지 않습니다."
    ],
    troubleshooting: [
      "IP가 다르면 키가 맞아도 접근이 거부될 수 있습니다.",
      "API 키 유효기간과 권한 범위를 확인하세요.",
      "정책이 불명확한 기능은 SellerHub가 자동으로 실행하지 않습니다."
    ]
  },
  toss: {
    title: "토스쇼핑",
    note: "토스쇼핑 공식 자체개발 방식에 따라 판매자가 Access Key와 Secret Key를 1회 등록합니다.",
    connectionMode: "키 1회 등록형",
    customerFlow: "일반 이용자: 토스쇼핑 파트너스에서 서버 IP를 등록하고 Access Key/Secret Key를 한 번 저장합니다. 이후 토큰 갱신은 SellerHub가 처리합니다.",
    fields: [
      { key: "accessKey", label: "Access Key", placeholder: "Access Key", hint: "상점 이름 → 가맹점·계정 관리 → 자체 개발" },
      { key: "secretKey", label: "Secret Key", secret: true, placeholder: "Secret Key", hint: "암호화 저장되며 저장 후 다시 표시하지 않습니다" }
    ],
    needsIp: true,
    policyNote: "공식 문서상 client_credentials 방식이며 등록된 IP에서만 API에 접근할 수 있습니다.",
    helpUrl: "https://shopping-docs.toss.im/dev/api-1/token",
    steps: [
      "토스쇼핑 파트너스 → 가맹점·계정 관리 → 자체 개발로 이동합니다.",
      "SellerHub 서버 출구 IP를 등록하고 키를 발급합니다.",
      "Access Key와 Secret Key를 SellerHub에 한 번 저장합니다.",
      "이후 Access Token 발급/재사용은 SellerHub가 자동 처리합니다."
    ],
    troubleshooting: [
      "401이면 키 조합 또는 토큰 만료를 확인하세요.",
      "403이면 파트너스에 등록한 허용 IP와 SellerHub 출구 IP가 같은지 확인하세요.",
      "키를 재발급했다면 SellerHub 저장값도 교체해야 합니다."
    ]
  },
  kakao: {
    title: "카카오 톡스토어",
    note: "SellerHub가 연동대행사 Admin Key를 서버에서 관리하고 이용자는 판매자 REST API Key만 1회 연결하는 구조입니다.",
    connectionMode: "대행사 + 판매자 키형",
    customerFlow: "일반 이용자: SellerHub의 카카오 연동대행사 계약/권한이 완료된 뒤 판매자센터에서 발급한 Seller REST API Key만 등록합니다.",
    operatorNote: "Admin App Key는 SellerHub 운영자 비밀정보이며 일반 판매자 입력창에 노출하지 않습니다.",
    commercialBlocked: true,
    fields: [
      { key: "sellerAppKey", label: "판매자 REST API Key", secret: true, placeholder: "Seller App Key", hint: "카카오쇼핑 판매자센터 → API 인증키" },
      { key: "channelIds", label: "Channel IDs", optional: true, placeholder: "101", hint: "비우면 톡스토어 기본값 101을 사용합니다" }
    ],
    approvalNote: "카카오쇼핑은 연동대행사와 판매자 연결(POST /v1/store/register)이 선행되어야 상품·주문 API를 사용할 수 있습니다.",
    policyNote: "SellerHub 연동대행사 검토/계약 및 권한 부여가 완료되기 전에는 자동 매핑과 LIVE 쓰기를 활성화하지 않습니다.",
    helpUrl: "https://shopping-developers.kakao.com/hc/ko/articles/4622576059919",
    steps: [
      "SellerHub 운영자가 카카오쇼핑 API 연동 검토/계약과 연동대행사 권한 부여를 완료합니다.",
      "이용자는 판매자센터에서 자신의 판매자 REST API Key를 발급합니다.",
      "판매자 Key만 SellerHub에 저장합니다. 운영자 Admin Key는 서버에서 결합합니다.",
      "SellerHub가 공식 판매자 연결 절차를 완료한 뒤 상품·주문 API를 사용합니다."
    ],
    troubleshooting: [
      "'운영자 Admin Key 설정 필요'가 나오면 SellerHub 대행사 승인이 아직 완료되지 않은 상태입니다.",
      "판매자 REST API Key가 현재 판매채널의 키인지 확인하세요.",
      "톡스토어만 연결하면 channel-ids는 101을 사용합니다."
    ]
  }
};

type Props = {
  state: ApiMarketConnections | null;
  loading: boolean;
  onReload: () => Promise<void>;
  onSave: (market: MarketId, values: MarketCredentialInput) => Promise<void>;
  onDelete: (market: MarketId) => Promise<void>;
  onVerify: (market: MarketId) => Promise<ApiMarketConnectionCheck>;
};

export function MarketConnections({ state, loading, onReload, onSave, onDelete, onVerify }: Props) {
  const [selected, setSelected] = useState<MarketId>("naver");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showAdminTest, setShowAdminTest] = useState(false);
  const [verification, setVerification] = useState<Partial<Record<MarketId, ApiMarketConnectionCheck>>>({});
  const spec = specs[selected];
  const connection = useMemo(() => state?.connections.find((item) => item.market === selected) ?? null, [state, selected]);
  const check = verification[selected];
  const configuredCount = state?.connections.filter((item) => item.configured).length ?? 0;
  const showCredentialForm = !spec.adminTestOnly || showAdminTest;

  const selectMarket = (market: MarketId) => {
    setSelected(market);
    setValues({});
    setError(null);
    setSaved(false);
    setShowGuide(true);
    setShowAdminTest(false);
  };

  const verify = async () => {
    if (!connection?.configured) {
      setError("먼저 필요한 연결 정보를 저장해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onVerify(selected);
      setVerification((current) => ({ ...current, [selected]: result }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "연결 확인에 실패했습니다.";
      setVerification((current) => ({ ...current, [selected]: { market: selected, ok: false, message, checkedAt: new Date().toISOString(), registrationSupported: false } }));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const next: MarketCredentialInput = {};
    for (const field of spec.fields) {
      const value = values[field.key]?.trim() ?? "";
      if (!value && !field.optional) {
        setError(`${field.label}을(를) 입력해 주세요.`);
        return;
      }
      if (value) next[field.key] = value;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(selected, next);
      setValues({});
      setSaved(true);
      try {
        const result = await onVerify(selected);
        setVerification((current) => ({ ...current, [selected]: result }));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "저장은 완료됐지만 연결 확인에 실패했습니다.";
        setVerification((current) => ({ ...current, [selected]: { market: selected, ok: false, message, checkedAt: new Date().toISOString(), registrationSupported: false } }));
      }
      window.setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연동 정보를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!connection?.configured) return;
    if (!window.confirm(`${spec.title} 연동 정보를 SellerHub에서 삭제할까요? 실제 마켓에서 발급된 키 자체는 폐기되지 않습니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selected);
      setValues({});
      setVerification((current) => {
        const next = { ...current };
        delete next[selected];
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연동 정보를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const copyIp = async () => {
    if (!state?.publicEgressIp) return;
    await navigator.clipboard.writeText(state.publicEgressIp);
  };

  return (
    <main className="manager-page connections-page">
      <div className="manager-header">
        <div>
          <h1>마켓 연동</h1>
          <p>마켓 공식 정책에 맞춰 가장 간단한 연결 방식을 사용합니다. 운영자용 비밀키는 일반 이용자에게 요구하지 않습니다.</p>
        </div>
        <button type="button" className="secondary-action" disabled={loading} onClick={() => void onReload()}><Link2 size={15} /> 상태 새로고침</button>
      </div>

      <section id="getting-started" className="setup-safety-banner">
        <ShieldCheck size={19} />
        <div>
          <strong>판매자가 해야 할 일만 보여줍니다</strong>
          <p>네이버는 커머스솔루션 자동 연결, 쿠팡·토스는 공식 키 1회 등록, G마켓은 셀링툴 판매자 ID 매핑, 카카오는 판매자 Key 1회 등록 방식으로 준비합니다. 현재 {configuredCount}개 마켓 연결정보가 저장되어 있습니다.</p>
        </div>
      </section>

      {!state?.storageReady ? (
        <section className="connection-warning">
          <ShieldCheck size={18} />
          <div><strong>암호화 저장소 설정 필요</strong><p>배포 서버의 암호화 비밀키 설정이 완료되기 전에는 마켓 연결정보 저장이 차단됩니다.</p></div>
        </section>
      ) : null}

      {state?.publicEgressIp ? (
        <section className="setup-ip-card">
          <div><strong>SellerHub 서버 고정 출구 IP</strong><code>{state.publicEgressIp}</code><p>IP 등록이 필요한 마켓에는 이 주소를 허용 IP로 등록하세요.</p></div>
          <button type="button" onClick={() => void copyIp()}><Clipboard size={15} /> IP 복사</button>
        </section>
      ) : (
        <section className="setup-ip-card muted"><TriangleAlert size={18} /><div><strong>서버 출구 IP가 아직 표시되지 않습니다.</strong><p>롯데ON·토스쇼핑처럼 허용 IP가 필요한 마켓은 운영자가 PUBLIC_EGRESS_IP를 설정한 뒤 연결하세요.</p></div></section>
      )}

      <div className="connections-grid">
        <section className="surface connection-list-panel">
          {markets.map((market) => {
            const status = state?.connections.find((item) => item.market === market.id);
            const marketCheck = verification[market.id];
            return (
              <button type="button" key={market.id} className={selected === market.id ? "connection-list-item active" : "connection-list-item"} onClick={() => selectMarket(market.id)}>
                <span className={`connection-market-icon connection-${market.id}`}>{market.short}</span>
                <div><strong>{market.name}</strong><small>{marketCheck?.ok ? "연결 확인됨" : status?.configured ? "연결정보 저장됨" : "미연동"}</small></div>
                {marketCheck?.ok ? <CheckCircle2 size={16} className="connection-ok" /> : null}
              </button>
            );
          })}
        </section>

        <section className="surface connection-editor-panel">
          <div className="connection-editor-heading">
            <div className="connection-key-icon"><KeyRound size={18} /></div>
            <div><h2>{spec.title}</h2><p>{spec.note}</p></div>
            <span className={check?.ok ? "connection-badge connected" : connection?.configured ? "connection-badge saved" : "connection-badge"}>{check?.ok ? "연결 확인됨" : connection?.configured ? "정보 저장됨" : "미연동"}</span>
          </div>

          <div className="market-guide-card connection-inline-guide">
            <div className="guide-credentials"><strong>연결 방식 · {spec.connectionMode}</strong></div>
            <p>{spec.customerFlow}</p>
            {spec.operatorNote ? <p className="approval-note">{spec.operatorNote}</p> : null}
            {spec.commercialBlocked ? <p className="ip-note">상용 자동 연결 준비가 끝나기 전까지 위험한 LIVE 쓰기는 잠겨 있습니다.</p> : null}
          </div>

          <div className="guide-card-actions">
            <a href={spec.helpUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> 공식 연동 안내</a>
            <button type="button" onClick={() => setShowGuide((current) => !current)}>{showGuide ? "상세 방법 접기" : "상세 방법 보기"}</button>
          </div>

          {showGuide ? (
            <div className="market-guide-card connection-inline-guide">
              <div className="guide-credentials"><strong>연결 순서</strong></div>
              <ol>{spec.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              {spec.approvalNote ? <p className="approval-note">{spec.approvalNote}</p> : null}
              {spec.policyNote ? <p className="ip-note">{spec.policyNote}</p> : null}
            </div>
          ) : null}

          {spec.adminTestOnly && !showAdminTest ? (
            <div className="market-guide-card connection-troubleshoot">
              <div className="guide-notes">
                <strong>일반 이용자는 여기서 API 키를 입력하지 않습니다.</strong>
                <p>네이버 커머스솔루션 등록 전 운영자 SELF 연결을 시험해야 할 때만 아래 관리자 테스트를 여세요.</p>
                <button type="button" className="secondary-action" onClick={() => setShowAdminTest(true)}>관리자 SELF 테스트 열기</button>
              </div>
            </div>
          ) : null}

          {showCredentialForm ? (
            <>
              <div className="connection-form-grid">
                {spec.fields.map((field) => (
                  <label key={field.key} className="connection-field">
                    <span>{field.label}{field.optional ? <small> 선택</small> : null}</span>
                    <input
                      type={field.secret ? "password" : "text"}
                      value={values[field.key] ?? ""}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                      placeholder={connection?.configured ? `${field.label} 새 값으로 교체` : field.placeholder}
                    />
                    {field.hint ? <small className="connection-field-hint">{field.hint}</small> : null}
                  </label>
                ))}
              </div>

              {spec.needsIp ? <p className="ip-note">이 마켓은 판매자센터에 서버 IP를 등록해야 합니다. 위 SellerHub 출구 IP와 등록 IP가 정확히 같아야 합니다.</p> : null}

              {error ? <div className="connection-error"><CircleAlert size={16} /> {error}</div> : null}
              {saved ? <div className="connection-success"><CheckCircle2 size={16} /> 암호화 저장 후 연결 확인까지 요청했습니다.</div> : null}
              {check ? (
                <div className={check.ok ? "connection-check-result ok" : "connection-check-result fail"}>
                  {check.ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
                  <div><strong>{check.ok ? "실제 API 연결 성공" : "연결 확인 실패"}</strong><p>{check.message}</p><small>{new Date(check.checkedAt).toLocaleString("ko-KR")}</small></div>
                </div>
              ) : null}

              {!check?.ok ? (
                <div className="market-guide-card connection-troubleshoot">
                  <div className="guide-notes"><strong>연결이 안 될 때</strong>{spec.troubleshooting.map((item) => <p key={item}>• {item}</p>)}</div>
                </div>
              ) : null}

              <div className="connection-actions">
                <button type="button" className="primary-action" disabled={busy || !state?.storageReady} onClick={() => void save()}><Save size={16} /> {busy ? "처리 중..." : spec.adminTestOnly ? "관리자 테스트 키 저장하고 확인" : connection?.configured ? "새 연결정보 저장하고 확인" : "저장하고 연결 확인"}</button>
                <button type="button" className="secondary-action" disabled={busy || !connection?.configured} onClick={() => void verify()}><PlugZap size={16} /> 연결만 다시 확인</button>
                <button type="button" className="danger-action" disabled={busy || !connection?.configured} onClick={() => void remove()}><Trash2 size={16} /> SellerHub에서 연동 삭제</button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
