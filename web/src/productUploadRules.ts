import type { MarketId } from "./data";

export type DiscountUnit = "PERCENT" | "WON";

export type PriceRange = {
  min: number;
  max: number;
  description: string;
};

const STOP_WORDS = new Set([
  "정품", "공식", "상품", "제품", "판매", "무료배송", "신상품", "추천", "인기", "특가", "세일"
]);

export function naverOptionPriceRange(salePrice: number): PriceRange {
  const price = Math.max(0, Math.trunc(salePrice || 0));
  if (price < 2_000) {
    return {
      min: 0,
      max: price,
      description: "판매가 2,000원 미만: 옵션가는 0원 ~ 판매가의 +100%"
    };
  }
  if (price < 10_000) {
    return {
      min: -Math.floor(price * 0.5),
      max: price,
      description: "판매가 2,000원 이상 10,000원 미만: -50% ~ +100%"
    };
  }
  return {
    min: -Math.floor(price * 0.5),
    max: Math.floor(price * 0.5),
    description: "판매가 10,000원 이상: -50% ~ +50%"
  };
}

export function naverDiscountRange(salePrice: number, unit: DiscountUnit): PriceRange {
  const price = Math.max(0, Math.trunc(salePrice || 0));
  if (unit === "PERCENT") {
    return {
      min: 1,
      max: 99,
      description: "SellerHub 안전범위: 1% ~ 99% (최종 판매가가 0원이 되지 않도록 제한)"
    };
  }
  return {
    min: 1,
    max: Math.max(1, Math.min(10_000_000, price > 1 ? price - 1 : 1)),
    description: "네이버 API 할인값은 1원 이상, 최대 10,000,000원이며 SellerHub는 판매가 미만으로 제한"
  };
}

export function discountedPrice(salePrice: number, unit: DiscountUnit, value: number): number {
  const price = Math.max(0, Math.trunc(salePrice || 0));
  const discount = Math.max(0, Number(value) || 0);
  if (unit === "PERCENT") return Math.max(0, Math.round(price * (1 - discount / 100)));
  return Math.max(0, price - Math.trunc(discount));
}

export function keywordPolicy(market: MarketId): { recommendedMax: number; hardMax: number | null; maxLength: number | null; note: string } {
  if (market === "coupang") {
    return {
      recommendedMax: 20,
      hardMax: 20,
      maxLength: 20,
      note: "쿠팡 공식 기준: 검색어 최대 20개, 검색어 1개당 20자 이내"
    };
  }
  if (market === "naver") {
    return {
      recommendedMax: 10,
      hardMax: null,
      maxLength: null,
      note: "상품명과 속성을 기준으로 SellerHub가 우선 10개를 추천합니다. 제한 태그는 등록 전 확인하세요."
    };
  }
  return {
    recommendedMax: 10,
    hardMax: null,
    maxLength: null,
    note: "상품명과 속성을 기준으로 SellerHub가 우선 10개를 추천합니다."
  };
}

export function validateKeyword(market: MarketId, keyword: string): string | null {
  const value = keyword.trim();
  if (!value) return "빈 검색어는 추가할 수 없습니다.";
  const policy = keywordPolicy(market);
  if (policy.maxLength && value.length > policy.maxLength) return `검색어는 ${policy.maxLength}자 이내로 입력해 주세요.`;
  if (market === "coupang" && !/^[0-9A-Za-z가-힣\s!@#$%^&*+\-;:'.]+$/.test(value)) {
    return "쿠팡에서 허용하지 않는 특수문자가 포함되어 있습니다.";
  }
  return null;
}

export function suggestKeywords(name: string, aliases: string[] = [], max = 10): string[] {
  const sources = [name, ...aliases]
    .map((value) => value.replace(/[()[\]{}|,/\\]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const suggestions: string[] = [];
  const push = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 30 || STOP_WORDS.has(normalized)) return;
    if (!suggestions.some((item) => item.toLowerCase() === normalized.toLowerCase())) suggestions.push(normalized);
  };

  for (const source of sources) {
    const words = source.split(" ").filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
    words.forEach(push);
    for (let index = 0; index < words.length - 1; index += 1) {
      push(`${words[index]} ${words[index + 1]}`);
      if ((words[index]?.length ?? 0) + (words[index + 1]?.length ?? 0) <= 18) push(`${words[index]}${words[index + 1]}`);
    }
    if (source.length <= 30) push(source);
  }
  return suggestions.slice(0, Math.max(1, max));
}

export function formatWon(value: number): string {
  return `${Math.trunc(value || 0).toLocaleString("ko-KR")}원`;
}
