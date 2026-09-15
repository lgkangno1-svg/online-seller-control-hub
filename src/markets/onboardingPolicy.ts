import { MARKETS, type Market } from "../core/types.js";

export type MarketOnboardingMode =
  | "delegated"
  | "seller_credentials"
  | "operator_mapping"
  | "policy_unverified";

export type MarketOnboardingExperience =
  | "one_click"
  | "one_time_key"
  | "seller_identifier"
  | "blocked";

export type MarketOnboardingPolicy = {
  market: Market;
  mode: MarketOnboardingMode;
  experience: MarketOnboardingExperience;
  sellerSecretRequired: boolean;
  operatorSetupRequired: boolean;
  commercialReady: boolean;
  description: string;
  blockingReason: string | null;
  officialGuideUrl: string;
};

/**
 * Public, secret-free marketplace onboarding policy metadata.
 *
 * Keep this conservative: a marketplace is only marked commercialReady when
 * the currently implemented SellerHub onboarding method matches a documented
 * provider flow. Unknown or contract-gated behavior must fail closed.
 */
export const MARKET_ONBOARDING_POLICIES: Record<Market, MarketOnboardingPolicy> = {
  naver: {
    market: "naver",
    mode: "delegated",
    experience: "one_click",
    sellerSecretRequired: false,
    operatorSetupRequired: true,
    commercialReady: false,
    description: "일반 판매자는 API 키를 발급하지 않고 네이버 커머스솔루션 구독/사용하기 흐름으로 연결합니다.",
    blockingReason: "SellerHub 커머스솔루션 등록, JWT 검증용 공개키와 운영 애플리케이션 설정이 완료되기 전에는 관리자 SELF 테스트만 허용합니다.",
    officialGuideUrl: "https://apicenter.commerce.naver.com/docs/solution-doc/3000/%EC%86%94%EB%A3%A8%EC%85%98-%EA%B5%AC%EB%8F%85-%EC%97%B0%EB%8F%99-%ED%94%84%EB%A1%9C%EC%84%B8%EC%8A%A4"
  },
  coupang: {
    market: "coupang",
    mode: "seller_credentials",
    experience: "one_time_key",
    sellerSecretRequired: true,
    operatorSetupRequired: false,
    commercialReady: true,
    description: "쿠팡 공식 WING Open API 방식은 판매자가 업체코드, Access Key, Secret Key를 1회 발급해 연결해야 합니다.",
    blockingReason: null,
    officialGuideUrl: "https://developers.coupangcorp.com/hc/ko/articles/360022939194"
  },
  gmarket: {
    market: "gmarket",
    mode: "operator_mapping",
    experience: "seller_identifier",
    sellerSecretRequired: false,
    operatorSetupRequired: true,
    commercialReady: false,
    description: "셀링툴사는 자체 ESM 마스터 ID/Secret으로 JWT를 만들고 판매자 ID를 ssi로 매핑하는 구조를 사용합니다.",
    blockingReason: "SellerHub 사업자 명의의 ESM Trading API 셀링툴 승인과 운영 실사용 협의가 끝날 때까지 판매자용 자동 연결을 열지 않습니다.",
    officialGuideUrl: "https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C"
  },
  lotteon: {
    market: "lotteon",
    mode: "policy_unverified",
    experience: "blocked",
    sellerSecretRequired: true,
    operatorSetupRequired: true,
    commercialReady: false,
    description: "현재 SellerHub는 판매자 API 인증키 방식만 보수적으로 지원하며 상용 위임 연동 정책을 공개 문서로 확정하지 못했습니다.",
    blockingReason: "롯데ON의 솔루션사/대행사 상용 연동 절차를 공식 채널에서 확인하기 전에는 신규 LIVE 연동과 쓰기를 차단합니다.",
    officialGuideUrl: "https://seller.lotteon.com/"
  },
  toss: {
    market: "toss",
    mode: "seller_credentials",
    experience: "one_time_key",
    sellerSecretRequired: true,
    operatorSetupRequired: false,
    commercialReady: true,
    description: "토스쇼핑 공식 자체개발 방식은 판매자가 파트너스에서 Access Key와 Secret Key를 1회 발급하고 서버 IP를 등록해야 합니다.",
    blockingReason: null,
    officialGuideUrl: "https://shopping-docs.toss.im/dev/api-1/token"
  },
  kakao: {
    market: "kakao",
    mode: "seller_credentials",
    experience: "one_time_key",
    sellerSecretRequired: true,
    operatorSetupRequired: true,
    commercialReady: false,
    description: "SellerHub는 연동대행사 Admin Key를 운영자 쪽에서 보유하고 판매자는 자신의 Seller REST API Key만 연결하는 구조가 목표입니다.",
    blockingReason: "카카오쇼핑 API 연동 검토/계약과 SellerHub 연동대행사 권한 부여가 완료되기 전에는 자동 판매자 매핑 및 LIVE 쓰기를 열지 않습니다.",
    officialGuideUrl: "https://shopping-developers.kakao.com/hc/ko/articles/4622576059919"
  }
};

export function marketOnboardingPolicies(): MarketOnboardingPolicy[] {
  return MARKETS.map((market) => MARKET_ONBOARDING_POLICIES[market]);
}
