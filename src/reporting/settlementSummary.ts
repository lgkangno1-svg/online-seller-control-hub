import { z } from "zod";
import { MARKETS } from "../core/types.js";

const settlementSchema = z.object({
  market: z.enum(MARKETS),
  settlementId: z.string().trim().min(1).max(120),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  salesAmount: z.number().int().nonnegative(),
  fees: z.number().int().nonnegative(),
  refunds: z.number().int().nonnegative(),
  payoutAmount: z.number().int(),
});

export const settlementsSchema = z.array(settlementSchema).max(10000);

export function summarizeSettlements(input: unknown) {
  const rows = settlementsSchema.parse(input);
  return {
    rows: rows.length,
    salesAmount: rows.reduce((sum, row) => sum + row.salesAmount, 0),
    fees: rows.reduce((sum, row) => sum + row.fees, 0),
    refunds: rows.reduce((sum, row) => sum + row.refunds, 0),
    payoutAmount: rows.reduce((sum, row) => sum + row.payoutAmount, 0),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, rows.filter((row) => row.market === market).reduce((sum, row) => sum + row.payoutAmount, 0)])),
  };
}
