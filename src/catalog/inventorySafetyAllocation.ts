import { z } from "zod";
import { MARKETS } from "../core/types.js";

const inputSchema = z.object({
  masterSku: z.string().trim().min(1),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative().default(0),
  safetyStock: z.number().int().nonnegative().default(0),
  markets: z.array(z.object({ market: z.enum(MARKETS), weight: z.number().positive().max(100) })).min(1)
});

export function allocateSellableStock(input: unknown) {
  const value = inputSchema.parse(input);
  const seen = new Set<string>();
  for (const item of value.markets) {
    if (seen.has(item.market)) throw new Error(`duplicate market allocation: ${item.market}`);
    seen.add(item.market);
  }
  const sellable = Math.max(0, value.onHand - value.reserved - value.safetyStock);
  const totalWeight = value.markets.reduce((sum, item) => sum + item.weight, 0);
  let assigned = 0;
  const allocations = value.markets.map((item, index) => {
    const quantity = index === value.markets.length - 1 ? sellable - assigned : Math.floor(sellable * item.weight / totalWeight);
    assigned += quantity;
    return { market: item.market, quantity };
  });
  return { masterSku: value.masterSku, sellable, blocked: value.onHand - sellable, allocations };
}
