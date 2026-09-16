import { z } from "zod";
import { MARKETS } from "../core/types.js";

const settlementInputSchema = z.object({
  market: z.enum(MARKETS),
  orderId: z.string().min(1).max(200),
  grossAmount: z.number().finite().nonnegative(),
  marketplaceFee: z.number().finite().nonnegative().default(0),
  shippingFee: z.number().finite().default(0),
  adjustmentAmount: z.number().finite().default(0),
  expectedSettlementAt: z.string().max(100).nullable().default(null),
  settledAt: z.string().max(100).nullable().default(null)
}).strict();

export type SettlementInput = z.input<typeof settlementInputSchema>;
export type SettlementRow = z.output<typeof settlementInputSchema> & {
  netAmount: number;
  status: "expected" | "settled";
};

export type SettlementSummary = {
  orders: number;
  grossAmount: number;
  marketplaceFee: number;
  shippingFee: number;
  adjustmentAmount: number;
  netAmount: number;
  expectedAmount: number;
  settledAmount: number;
  byMarket: Record<string, { orders: number; netAmount: number }>;
};

export function normalizeSettlement(input: SettlementInput): SettlementRow {
  const row = settlementInputSchema.parse(input);
  return {
    ...row,
    netAmount: roundMoney(row.grossAmount - row.marketplaceFee + row.shippingFee + row.adjustmentAmount),
    status: row.settledAt ? "settled" : "expected"
  };
}

export function summarizeSettlements(inputs: SettlementInput[]): SettlementSummary {
  const rows = inputs.map(normalizeSettlement);
  const summary: SettlementSummary = {
    orders: rows.length,
    grossAmount: 0,
    marketplaceFee: 0,
    shippingFee: 0,
    adjustmentAmount: 0,
    netAmount: 0,
    expectedAmount: 0,
    settledAmount: 0,
    byMarket: {}
  };

  for (const row of rows) {
    summary.grossAmount += row.grossAmount;
    summary.marketplaceFee += row.marketplaceFee;
    summary.shippingFee += row.shippingFee;
    summary.adjustmentAmount += row.adjustmentAmount;
    summary.netAmount += row.netAmount;
    if (row.status === "settled") summary.settledAmount += row.netAmount;
    else summary.expectedAmount += row.netAmount;

    const market = summary.byMarket[row.market] ?? { orders: 0, netAmount: 0 };
    market.orders += 1;
    market.netAmount = roundMoney(market.netAmount + row.netAmount);
    summary.byMarket[row.market] = market;
  }

  summary.grossAmount = roundMoney(summary.grossAmount);
  summary.marketplaceFee = roundMoney(summary.marketplaceFee);
  summary.shippingFee = roundMoney(summary.shippingFee);
  summary.adjustmentAmount = roundMoney(summary.adjustmentAmount);
  summary.netAmount = roundMoney(summary.netAmount);
  summary.expectedAmount = roundMoney(summary.expectedAmount);
  summary.settledAmount = roundMoney(summary.settledAmount);
  return summary;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
