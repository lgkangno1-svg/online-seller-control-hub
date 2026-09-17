import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const syncRowSchema = z.object({
  masterSku: z.string().trim().min(1).max(120),
  market: z.enum(MARKETS),
  externalId: z.string().trim().min(1).max(300),
  currentPrice: z.number().int().nonnegative().nullable(),
  currentStock: z.number().int().nonnegative().nullable(),
  targetPrice: z.number().int().min(100).max(1_000_000_000).optional(),
  targetStock: z.number().int().nonnegative().max(10_000_000).optional()
}).refine((row) => row.targetPrice !== undefined || row.targetStock !== undefined, "sync target is empty");

const requestSchema = z.array(syncRowSchema).min(1).max(1000).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = `${row.market}:${row.externalId}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalId"], message: "duplicate marketplace product" });
    seen.add(key);
  });
});

export type PriceStockSyncAction = {
  masterSku: string;
  market: Market;
  externalId: string;
  price?: { before: number | null; after: number };
  stock?: { before: number | null; after: number };
};

/** Builds a reviewable delta plan only. Marketplace writes remain behind approval. */
export function buildPriceStockSyncPlan(input: unknown) {
  const rows = requestSchema.parse(input);
  const actions: PriceStockSyncAction[] = rows.flatMap((row) => {
    const price = row.targetPrice !== undefined && row.targetPrice !== row.currentPrice ? { before: row.currentPrice, after: row.targetPrice } : undefined;
    const stock = row.targetStock !== undefined && row.targetStock !== row.currentStock ? { before: row.currentStock, after: row.targetStock } : undefined;
    return price || stock ? [{ masterSku: row.masterSku, market: row.market, externalId: row.externalId, ...(price ? { price } : {}), ...(stock ? { stock } : {}) }] : [];
  });
  return {
    actions,
    totalActions: actions.length,
    priceChanges: actions.filter((action) => action.price).length,
    stockChanges: actions.filter((action) => action.stock).length,
    markets: [...new Set(actions.map((action) => action.market))],
    requiresConfirmation: actions.length > 0
  };
}
