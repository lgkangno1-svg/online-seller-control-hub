import { CheckCircle2, ExternalLink, KeyRound, Network, PackageCheck, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import type { ApiMarketConnections } from "../api";
import { markets, type MarketId } from "../data";

type Props = {
  connections: ApiMarketConnections | null;
  onLoadConnections: () => Promise<void>;
  onNavigate: (page: string) => void;
};

type Guide = {
  title: string;
  officialUrl: string;
  credentials: string[];
  steps: string[];
  notes: string[];
  needsIp?: boolean;
};

const guides: Record<MarketId, Guide> = {
  naver: {
    title: "네이버 스마트스토어",
    officialUrl: "https://apicenter.commerce.naver.com/ko/basic/getstart/before",
    credentials: ["Client ID", "Client Secret", "판매자 UID(account_id)"],
    steps: [
      "네이버 커머스API센터에 가입하고 애플리케이션을 등록합니다.",
      "판매자 상품/주문 API를 사용할 수 있도록 SELLER 권한 연동을 준비합니다.",
      "애플리케이션의 Client ID·Client Secret과 판매자 UID를 SellerHub에 입력합니다.",
      "저장 직후 [연결 확인]이 성공하는지 확인합니다."
    ],
    notes: [
      "SellerHub는 판매자 데이터 접근에 SELLER 유형 토큰을 사용합니다.",
      "인증 토큰은 3시간 유효하며 SellerHub가 만료 전까지 재사용합니다.",
      "옵션상품 재고는 옵션 식별이 안전할 때만 변경합니다."
    ]
  },
  coupang: {
    title: "쿠팡",
    officialUrl: "https://developers.coupangcorp.com/hc/ko/articles/360022939194",
    credentials: ["Access Key", "Secret Key", "Vendor ID(업체코드)"],
    steps: [
      "WING 로그인 → 우측 상단 아이디 → 판매자정보/추가판매정보로 이동합니다.",
      "OPEN API 키 발급 약관에 동의하고 OPEN API 키를 발급합니다.",
      "화면에 표시된 업체코드(Vendor ID), Access Key, Secret Key를 확인합니다.",
      "SellerHub에 세 값을 저장하고 실제 API 연결 확인을 실행합니다."
    ],
    notes: [
      "Secret Key는 브라우저에 다시 표시하지 않고 서버 암호화 저장소에 보관합니다.",
      "서버에서 해외 IP 접근을 막고 있으면 쿠팡 API 호출이 실패할 수 있습니다.",
      "신규 상품 등록은 카테고리·브랜드·필수 구매옵션 검증을 통과해야 합니다."
    ]
  },
  gmarket: {
    title: "G마켓 / ESM Trading API",
    officialUrl: "https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C",
    credentials: ["ESM Master ID", "Secret Key", "G마켓 판매자 ID", "Issuer/domain"],
    steps: [
      "G마켓/옥션 판매자 회원과 ESM+ 마스터 ID를 준비합니다.",
      "ESM Trading API 사용 신청을 하고 내부 승인을 받습니다.",
      "승인 시 받은 인증 정보를 SellerHub의 G마켓 연동 화면에 입력합니다.",
      "개발 테스트 완료 후 운영 실사용 가능 여부를 ESM 측과 확인합니다."
    ],
    notes: [
      "API 신청 자체가 자동 승인되는 구조가 아니므로 승인 전에는 LIVE 기능을 사용할 수 없습니다.",
      "판매중지를 장기간 유지하면 상품 상태에 영향을 줄 수 있어 SellerHub가 경고를 표시합니다.",
      "HTTPS 기반 엔드포인트만 사용합니다."
    ]
  },
  lotteon: {
    title: "롯데ON",
    officialUrl: "https://seller.lotteon.com/",
    credentials: ["API 인증키"],
    steps: [
      "롯데ON 판매자센터에 로그인합니다.",
      "판매자정보 → OpenAPI → OpenAPI 관리로 이동합니다.",
      "직접입력 연동을 선택하고 SellerHub 서버의 고정 출구 IP를 등록합니다.",
      "키발급을 눌러 API 인증키를 받은 뒤 SellerHub에 저장합니다."
    ],
    notes: [
      "판매자센터에 등록한 서버 IP와 실제 SellerHub 출구 IP가 달라지면 인증이 실패합니다.",
      "API 인증키의 유효기간을 확인하고 만료 전에 교체하세요.",
      "문서로 확정되지 않은 쓰기 API는 SellerHub가 자동으로 실행하지 않습니다."
    ],
    needsIp: true
  },
  toss: {
    title: "토스쇼핑",
    officialUrl: "https://shopping-docs.toss.im/dev/api-1/token",
    credentials: ["Access Key", "Secret Key"],
    steps: [
      "토스쇼핑 파트너스에 로그인합니다.",
      "상점 이름 → 가맹점·계정 관리 → 자체 개발로 이동합니다.",
      "키 발급에서 SellerHub 서버의 API 호출 IP를 등록합니다.",
      "발급된 Access Key와 Secret Key를 SellerHub에 저장합니다."
    ],
    notes: [
      "등록한 IP에서만 API에 접근할 수 있으므로 출구 IP가 바뀌면 다시 등록해야 합니다.",
      "Access Token을 API 호출마다 새로 발급하면 이용 제한이 생길 수 있어 SellerHub가 토큰을 캐시합니다.",
      "테스트/운영 환경 키와 엔드포인트를 섞지 마세요."
    ],
    needsIp: true
  },
  kakao: {
    title: "카카오 톡스토어",
    officialUrl: "https://shopping-developers.kakao.com/hc/ko/articles/4622576059919",
    credentials: ["Admin App Key", "Seller App Key(REST API Key)", "Channel IDs = 101"],
    steps: [
      "카카오쇼핑 API 연동 검토와 계약/연동대행사 등록 절차를 먼저 완료합니다.",
      "연동대행사 앱의 Admin Key를 확인합니다.",
      "카카오쇼핑 판매자센터 → 정보관리 → 판매채널 정보 → API 인증키에서 판매자 REST API Key를 확인합니다.",
      "톡스토어는 channel-ids=101로 SellerHub에 저장하고 연결 확인을 실행합니다."
    ],
    notes: [
      "연동대행사와 판매자 연결이 완료되지 않으면 상품/주문 API 호출이 실패합니다.",
      "Admin App Key와 Seller App Key는 서로 다른 앱/권한의 키여야 합니다.",
      "카테고리 개편 가능성이 있어 상품 등록 직전 최신 카테고리를 다시 조회합니다."
    ]
  }
};

export function SetupGuide({ connections, onLoadConnections, onNavigate }: Props) {
  const configuredCount = connections?.connections.filter((item) => item.configured).length ?? 0;
  const connectedNames = connections?.connections.filter((item) => item.configured).map((item) => item.market) ?? [];

  return (
    <main className="setup-guide-page">
      <section className="setup-hero">
        <div>
          <span className="eyebrow">GETTING STARTED</span>
          <h1>처음 10분 설정 가이드</h1>
          <p>개발 지식이 없어도 순서대로 따라 하면 마켓 API 연결부터 안전한 테스트까지 완료할 수 있습니다.</p>
        </div>
        <button type="button" className="setup-primary" onClick={() => onNavigate("마켓 연동")}><Sparkles size={17} /> 마켓 연결 시작</button>
      </section>

      <section className="setup-progress-grid">
        <article className="setup-step-card done">
          <span>1</span><ShieldCheck size={22} />
          <div><strong>SellerHub 계정 로그인</strong><p>완료되었습니다.</p></div>
        </article>
        <article className={configuredCount > 0 ? "setup-step-card done" : "setup-step-card"}>
          <span>2</span><KeyRound size={22} />
          <div><strong>마켓 API 키 연결</strong><p>{configuredCount > 0 ? `${configuredCount}개 마켓 키 저장됨` : "아래 발급 가이드를 보고 키를 연결하세요."}</p></div>
        </article>
        <article className="setup-step-card">
          <span>3</span><PackageCheck size={22} />
          <div><strong>상품 매핑</strong><p>기존 마켓 상품을 Master SKU에 연결합니다.</p></div>
          <button type="button" onClick={() => onNavigate("상품 관리")}>상품 관리 열기</button>
        </article>
        <article className="setup-step-card">
          <span>4</span><CheckCircle2 size={22} />
          <div><strong>DRY RUN으로 먼저 테스트</strong><p>실제 가격·재고를 바꾸기 전에 명령 미리보기를 확인합니다.</p></div>
          <button type="button" onClick={() => onNavigate("AI 명령")}>AI 명령 테스트</button>
        </article>
      </section>

      <section className="setup-safety-banner">
        <TriangleAlert size={19} />
        <div><strong>API 키는 SellerHub 서버에 암호화 저장됩니다.</strong><p>Secret Key를 메신저·이메일·스크린샷으로 공유하지 마세요. 연결 실패 시 키 전체를 보내지 말고 오류 메시지만 전달하세요.</p></div>
      </section>

      {connections?.publicEgressIp ? (
        <section className="setup-ip-card">
          <Network size={20} />
          <div><strong>SellerHub 서버 출구 IP</strong><code>{connections.publicEgressIp}</code><p>IP 허용 등록을 요구하는 마켓에는 이 값을 입력하세요.</p></div>
          <button type="button" onClick={() => navigator.clipboard.writeText(connections.publicEgressIp ?? "")}>IP 복사</button>
        </section>
      ) : (
        <section className="setup-ip-card muted"><Network size={20} /><div><strong>서버 출구 IP 확인 필요</strong><p>롯데ON·토스쇼핑 등 IP 등록이 필요한 마켓을 연결하기 전에 서버 출구 IP가 표시되는지 확인하세요.</p></div><button type="button" onClick={() => void onLoadConnections()}>다시 확인</button></section>
      )}

      <div className="setup-section-head">
        <div><span className="eyebrow">API KEY GUIDE</span><h2>마켓별 API 키 발급 방법</h2></div>
        <button type="button" className="secondary-action" onClick={() => onNavigate("마켓 연동")}>키 입력 화면 열기</button>
      </div>

      <section className="market-guide-grid">
        {markets.map((market) => {
          const guide = guides[market.id];
          const configured = connectedNames.includes(market.id);
          return (
            <article key={market.id} className="market-guide-card">
              <header>
                <span className={`setup-market-icon setup-${market.id}`}>{market.short}</span>
                <div><h3>{guide.title}</h3><small>{configured ? "SellerHub에 키 저장됨" : "아직 미연동"}</small></div>
                {configured ? <CheckCircle2 size={18} className="guide-ok" /> : null}
              </header>

              <div className="guide-credentials">
                <strong>SellerHub에 입력할 값</strong>
                <div>{guide.credentials.map((item) => <code key={item}>{item}</code>)}</div>
              </div>

              <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>

              <div className="guide-notes">
                <strong>막히기 쉬운 부분</strong>
                {guide.notes.map((note) => <p key={note}>• {note}</p>)}
              </div>

              <div className="guide-card-actions">
                <a href={guide.officialUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> 공식 안내 열기</a>
                <button type="button" onClick={() => onNavigate("마켓 연동")}>SellerHub에 입력</button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="setup-faq">
        <h2>연결이 안 될 때 먼저 확인하세요</h2>
        <div className="setup-faq-grid">
          <article><strong>401 / 인증 실패</strong><p>키 앞뒤 공백, 키 종류, 판매자 ID/UID, 만료 여부를 확인한 뒤 저장하고 다시 연결 확인하세요.</p></article>
          <article><strong>403 / 접근 거부</strong><p>API 사용 승인 여부, IP 허용목록, 판매자-연동대행사 연결 상태를 확인하세요.</p></article>
          <article><strong>키 저장은 됐는데 연결 실패</strong><p>SellerHub는 단순 저장 성공이 아니라 실제 보호 API 조회가 성공해야 연결 완료로 판단합니다.</p></article>
          <article><strong>상품 등록 버튼이 비활성</strong><p>마켓 연결 확인, 필수 카테고리/배송지/고시 정보, 서버의 상품등록 안전 스위치를 순서대로 확인하세요.</p></article>
        </div>
      </section>
    </main>
  );
}
