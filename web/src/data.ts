export type MarketId = "naver" | "coupang" | "gmarket" | "lotteon" | "toss" | "kakao";

export type Product = {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  stock: number | null;
  updatedAt: string;
  enabledMarkets: MarketId[];
};

export type CommandHistoryItem = {
  id: string;
  command: string;
  status: "done" | "cancelled" | "preview";
  time: string;
};

export const markets: Array<{ id: MarketId; name: string; short: string; connected: boolean; count: number }> = [
  { id: "naver", name: "네이버", short: "N", connected: true, count: 1245 },
  { id: "coupang", name: "쿠팡", short: "C", connected: true, count: 1231 },
  { id: "gmarket", name: "G마켓", short: "G", connected: true, count: 1213 },
  { id: "lotteon", name: "롯데ON", short: "L", connected: true, count: 1102 },
  { id: "toss", name: "토스쇼핑", short: "T", connected: true, count: 982 },
  { id: "kakao", name: "카카오 톡딜", short: "K", connected: false, count: 876 }
];

export const initialProducts: Product[] = [
  { id: "p1", name: "홍옥 사과 5kg", sku: "APPLE-HONGOK-5KG", price: 39900, stock: 42, updatedAt: "2026.09.10", enabledMarkets: ["naver", "coupang", "gmarket", "lotteon", "toss"] },
  { id: "p2", name: "머스크멜론 2수", sku: "MELON-MUSK-2", price: 45900, stock: 18, updatedAt: "2026.09.10", enabledMarkets: ["naver", "coupang", "gmarket", "lotteon", "toss"] },
  { id: "p3", name: "애플망고 3.6kg", sku: "MANGO-APPLE-3.6", price: 42900, stock: 0, updatedAt: "2026.09.09", enabledMarkets: ["naver"] },
  { id: "p4", name: "프리미엄 한우세트", sku: "BEEF-PREMIUM-1", price: 129000, stock: 7, updatedAt: "2026.09.09", enabledMarkets: ["naver", "coupang", "gmarket", "lotteon", "toss"] },
  { id: "p5", name: "제주 딱새우 1kg", sku: "SHRIMP-JEJU-1", price: 59900, stock: 25, updatedAt: "2026.09.08", enabledMarkets: ["naver", "coupang", "gmarket", "lotteon", "toss"] }
];

export const initialHistory: CommandHistoryItem[] = [
  { id: "h1", command: "홍옥 5kg 쿠팡 제외 품절", status: "done", time: "14:32" },
  { id: "h2", command: "애플망고 가격 39,900원으로 변경", status: "done", time: "10:21" },
  { id: "h3", command: "오늘 주문 몇 건이야?", status: "preview", time: "09:15" },
  { id: "h4", command: "제주 딱새우 재고 100개로 변경", status: "cancelled", time: "09:03" }
];

export function formatWon(value: number | null) {
  return value === null ? "미확인" : `${value.toLocaleString("ko-KR")}원`;
}
