import { z } from "zod";
import { MARKETS } from "../core/types.js";

const itemSchema = z.object({
  market: z.enum(MARKETS), externalOrderLineId: z.string().min(1), masterSku: z.string().optional(),
  status: z.enum(["new","confirmed","preparing","shipped","delivered","cancelled"]), quantity: z.number().int().positive()
});

export function buildBulkOrderWorklist(input: unknown) {
  const items = z.array(itemSchema).max(5000).parse(input);
  const seen = new Set<string>();
  const actionable = [] as typeof items;
  const blocked: Array<{market:string;externalOrderLineId:string;reason:string}> = [];
  for (const item of items) {
    const key = `${item.market}:${item.externalOrderLineId}`;
    if (seen.has(key)) throw new Error(`duplicate order line: ${key}`); seen.add(key);
    if (!item.masterSku) { blocked.push({market:item.market,externalOrderLineId:item.externalOrderLineId,reason:"unmapped_sku"}); continue; }
    if (!["new","confirmed","preparing"].includes(item.status)) { blocked.push({market:item.market,externalOrderLineId:item.externalOrderLineId,reason:"terminal_or_ineligible_status"}); continue; }
    actionable.push(item);
  }
  return { actionable, blocked, summary: { total: items.length, actionable: actionable.length, blocked: blocked.length, units: actionable.reduce((n,x)=>n+x.quantity,0) } };
}
