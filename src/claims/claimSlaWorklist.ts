import { z } from "zod";
import { MARKETS } from "../core/types.js";

const claimSchema = z.object({
  market: z.enum(MARKETS),
  externalClaimId: z.string().trim().min(1),
  type: z.enum(["cancel", "return", "exchange"]),
  status: z.enum(["requested", "collecting", "reviewing"]),
  requestedAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true })
});

export function buildClaimSlaWorklist(input: unknown, now = new Date()) {
  const claims = z.array(claimSchema).max(5000).parse(input);
  const seen = new Set<string>();
  return claims.map((claim) => {
    const key = `${claim.market}:${claim.externalClaimId}`;
    if (seen.has(key)) throw new Error(`duplicate claim: ${key}`);
    seen.add(key);
    const remainingMinutes = Math.floor((Date.parse(claim.dueAt) - now.getTime()) / 60000);
    const urgency = remainingMinutes < 0 ? "overdue" : remainingMinutes <= 120 ? "critical" : remainingMinutes <= 1440 ? "due_today" : "normal";
    return { ...claim, remainingMinutes, urgency };
  }).sort((a, b) => a.remainingMinutes - b.remainingMinutes);
}

export function summarizeClaimSla(input: unknown, now = new Date()) {
  const rows = buildClaimSlaWorklist(input, now);
  return {
    total: rows.length,
    overdue: rows.filter((x) => x.urgency === "overdue").length,
    critical: rows.filter((x) => x.urgency === "critical").length,
    dueToday: rows.filter((x) => x.urgency === "due_today").length
  };
}
