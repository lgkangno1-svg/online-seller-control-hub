import type { MarketId, Product } from "./data";
import { markets } from "./data";

export type CommandAction =
  | { type: "out_of_stock" }
  | { type: "set_stock"; value: number }
  | { type: "set_price"; value: number }
  | { type: "pause" }
  | { type: "resume" };

export type CommandPreview = {
  raw: string;
  product: Product;
  action: CommandAction;
  targetMarkets: MarketId[];
};

const marketAliases: Record<MarketId, string[]> = {
  naver: ["네이버", "스마트스토어"],
  coupang: ["쿠팡"],
  gmarket: ["지마켓", "g마켓", "gmarket"],
  lotteon: ["롯데온", "롯데on"],
  toss: ["토스", "토스쇼핑"],
  kakao: ["카카오", "톡딜", "카카오톡딜"]
};

function normalize(text: string) {
  return text.toLowerCase().replace(/,/g, "").trim();
}

function resolveProduct(command: string, products: Product[]) {
  const normalized = normalize(command);
  const candidates = products.filter((product) => {
    const productTokens = normalize(product.name).split(/\s+/).filter((token) => token.length >= 2);
    return normalized.includes(product.sku.toLowerCase()) || productTokens.filter((token) => normalized.includes(token)).length >= 2;
  });

  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0 ? "상품을 정확히 찾지 못했습니다." : "여러 상품이 매칭되어 실행할 수 없습니다.");
  }

  return candidates[0];
}

function resolveAction(command: string): CommandAction {
  const normalized = normalize(command);

  if (normalized.includes("품절")) return { type: "out_of_stock" };
  if (normalized.includes("판매중지") || normalized.includes("판매 중지")) return { type: "pause" };
  if (normalized.includes("판매재개") || normalized.includes("판매 재개")) return { type: "resume" };

  const stock = normalized.match(/재고\s*(?:를|는|수량)?\s*(\d+)/);
  if (stock) return { type: "set_stock", value: Number(stock[1]) };

  const price = normalized.match(/(?:가격|판매가).*?(\d{4,})/);
  if (price) return { type: "set_price", value: Number(price[1]) };

  throw new Error("지원하는 변경 명령을 찾지 못했습니다. 품절, 재고 N개, 가격 N원, 판매중지, 판매재개를 사용해 주세요.");
}

function resolveMarkets(command: string, product: Product): MarketId[] {
  const normalized = normalize(command);
  const excluded = new Set<MarketId>();

  for (const market of markets) {
    const shouldExclude = marketAliases[market.id].some((alias) => {
      const token = alias.toLowerCase();
      return normalized.includes(`${token} 제외`) || normalized.includes(`${token} 빼고`);
    });
    if (shouldExclude) excluded.add(market.id);
  }

  const explicitlyMentioned = markets
    .filter((market) => !excluded.has(market.id))
    .filter((market) => marketAliases[market.id].some((alias) => normalized.includes(alias.toLowerCase())))
    .map((market) => market.id);

  const selected = explicitlyMentioned.length > 0 ? explicitlyMentioned : [...product.enabledMarkets];
  return [...new Set(selected)]
    .filter((id) => !excluded.has(id))
    .filter((id) => product.enabledMarkets.includes(id));
}

export function parseCommand(raw: string, products: Product[]): CommandPreview {
  const product = resolveProduct(raw, products);
  const action = resolveAction(raw);
  const targetMarkets = resolveMarkets(raw, product);

  if (targetMarkets.length === 0) throw new Error("변경 대상 마켓이 없습니다.");
  return { raw, product, action, targetMarkets };
}

export function describeAction(action: CommandAction) {
  if (action.type === "out_of_stock") return "재고를 0으로 변경";
  if (action.type === "set_stock") return `재고를 ${action.value}개로 변경`;
  if (action.type === "set_price") return `판매가를 ${action.value.toLocaleString("ko-KR")}원으로 변경`;
  if (action.type === "pause") return "판매 중지";
  return "판매 재개";
}
