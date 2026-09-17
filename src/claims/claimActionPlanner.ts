import { z } from "zod";
import { MARKETS } from "../core/types.js";

const claimActionSchema = z.object({
  market: z.enum(MARKETS), externalClaimId: z.string().trim().min(1).max(120),
  type: z.enum(["cancel","return","exchange"]),
  action: z.enum(["approve","reject","complete_collection","complete_refund","reship"]),
  reason: z.string().trim().min(1).max(500),
  refundAmount: z.number().int().nonnegative().optional()
});

export function planClaimActions(input: unknown) {
  const rows=z.array(claimActionSchema).max(2000).parse(input); const seen=new Set<string>();
  return rows.map(row=>{ const key=`${row.market}:${row.externalClaimId}:${row.action}`; if(seen.has(key)) throw new Error(`duplicate claim action: ${key}`); seen.add(key);
    const destructive=["approve","reject","complete_refund","reship"].includes(row.action);
    if(row.action==="complete_refund" && row.refundAmount===undefined) throw new Error(`refund amount required: ${key}`);
    return {...row,risk:destructive?"high" as const:"normal" as const,requiresConfirmation:destructive};
  });
}
