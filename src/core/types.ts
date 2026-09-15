import { z } from "zod";

export const MARKETS = ["naver", "coupang", "gmarket", "lotteon", "toss", "kakao"] as const;
export type Market = (typeof MARKETS)[number];

export const WRITE_ACTIONS = [
  "SET_OUT_OF_STOCK",
  "SET_STOCK",
  "SET_PRICE",
  "STOP_SALES",
  "RESUME_SALES"
] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

export const commandSchema = z.object({
  action: z.enum(WRITE_ACTIONS),
  productQuery: z.string().trim().min(1).max(200),
  markets: z.array(z.enum(MARKETS)).min(1),
  value: z.number().int().nonnegative().nullable(),
  rationale: z.string().max(300).optional()
}).superRefine((command, ctx) => {
  if ((command.action === "SET_PRICE" || command.action === "SET_STOCK") && command.value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "value is required" });
  }
  if (command.action === "SET_PRICE" && command.value !== null && command.value < 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "price looks invalid" });
  }
});

export type ParsedCommand = z.infer<typeof commandSchema>;

export type MarketState = {
  market: Market;
  externalId: string;
  price: number | null;
  stock: number | null;
  saleStatus: "ON_SALE" | "STOPPED" | "OUT_OF_STOCK" | "UNKNOWN";
};

export type MarketExecutionResult = {
  market: Market;
  ok: boolean;
  message: string;
  before?: MarketState;
  after?: MarketState;
};
