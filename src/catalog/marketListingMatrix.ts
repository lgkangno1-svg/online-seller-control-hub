import { z } from "zod";
import { MARKETS } from "../core/types.js";

const listingSchema = z.object({
  masterSku: z.string().trim().min(1),
  market: z.enum(MARKETS),
  externalId: z.string().trim().min(1).optional(),
  status: z.enum(["unlisted", "pending", "active", "paused", "rejected", "ended"]),
  price: z.number().int().nonnegative().optional(),
  stock: z.number().int().nonnegative().optional(),
  lastSyncedAt: z.string().datetime({ offset: true }).optional(),
  error: z.string().trim().min(1).optional()
});

export type MarketListing = z.infer<typeof listingSchema>;

export function buildMarketListingMatrix(input: unknown) {
  const items = z.array(listingSchema).max(10000).parse(input);
  const seen = new Set<string>();
  const rows = new Map<string, Record<string, MarketListing>>();
  for (const item of items) {
    const key = `${item.masterSku}:${item.market}`;
    if (seen.has(key)) throw new Error(`duplicate listing: ${key}`);
    seen.add(key);
    const row = rows.get(item.masterSku) ?? {};
    row[item.market] = item;
    rows.set(item.masterSku, row);
  }
  return [...rows.entries()].map(([masterSku, markets]) => ({ masterSku, markets }));
}

export function summarizeMarketListings(input: unknown) {
  const items = z.array(listingSchema).max(10000).parse(input);
  return {
    total: items.length,
    active: items.filter((x) => x.status === "active").length,
    attention: items.filter((x) => x.status === "rejected" || Boolean(x.error)).length,
    stale: items.filter((x) => !x.lastSyncedAt).length,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, items.filter((x) => x.market === market).length]))
  };
}
