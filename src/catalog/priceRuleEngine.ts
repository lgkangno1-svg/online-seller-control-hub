import { z } from "zod";
import { MARKETS } from "../core/types.js";

const ruleSchema=z.object({market:z.enum(MARKETS),masterSku:z.string().min(1).max(120),basePrice:z.number().int().nonnegative(),adjustmentType:z.enum(["percent","fixed"]),adjustment:z.number().finite(),minimumPrice:z.number().int().nonnegative().optional(),maximumPrice:z.number().int().nonnegative().optional()});
export type PriceRule=z.infer<typeof ruleSchema>;

/** Computes proposed channel prices only; publishing remains an explicitly confirmed workflow. */
export function planMarketplacePrices(input: unknown){
 const rules=z.array(ruleSchema).max(5000).parse(input); const seen=new Set<string>();
 return rules.map(r=>{ const key=`${r.market}:${r.masterSku}`; if(seen.has(key)) throw new Error(`duplicate price rule: ${key}`); seen.add(key);
   let price=r.adjustmentType==="percent" ? Math.round(r.basePrice*(1+r.adjustment/100)) : Math.round(r.basePrice+r.adjustment);
   if(r.minimumPrice!==undefined) price=Math.max(price,r.minimumPrice); if(r.maximumPrice!==undefined) price=Math.min(price,r.maximumPrice); if(price<0) throw new Error(`negative planned price: ${key}`);
   return {...r,plannedPrice:price,requiresConfirmation:true as const}; });
}
