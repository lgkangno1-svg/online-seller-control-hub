import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

export const CLAIM_TYPES = ["cancel", "return", "exchange"] as const;
export const CLAIM_STATUSES = ["requested", "processing", "completed", "rejected"] as const;

const claimSchema = z.object({
  market: z.enum(MARKETS),
  externalClaimId: z.string().trim().min(1).max(120),
  orderLineId: z.string().trim().min(1).max(120),
  type: z.enum(CLAIM_TYPES),
  status: z.enum(CLAIM_STATUSES),
  reason: z.string().trim().max(500).optional(),
  requestedAt: z.string().datetime({ offset: true })
});

export type ClaimInboxItem = z.infer<typeof claimSchema>;
export type ClaimMarketBatch = { market: Market; items: ClaimInboxItem[] };

export const claimInboxSchema = z.array(claimSchema).max(1000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalClaimId}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalClaimId"], message: "duplicate marketplace claim" });
    }
    seen.add(key);
  });
});

/**
 * Normalizes marketplace claim feeds into one read-only inbox. Processing a
 * cancel/return/exchange remains a separate explicitly approved write flow.
 */
export function normalizeClaimInbox(input: unknown): ClaimInboxItem[] {
  return claimInboxSchema.parse(input).sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export function groupClaimsByMarket(input: unknown): ClaimMarketBatch[] {
  const claims = normalizeClaimInbox(input);
  const grouped = new Map<Market, ClaimInboxItem[]>();
  for (const claim of claims) {
    const items = grouped.get(claim.market);
    if (items) items.push(claim);
    else grouped.set(claim.market, [claim]);
  }
  return [...grouped.entries()].map(([market, items]) => ({ market, items }));
}

export function summarizeClaimInbox(input: unknown) {
  const claims = normalizeClaimInbox(input);
  return {
    total: claims.length,
    actionable: claims.filter((claim) => claim.status === "requested" || claim.status === "processing").length,
    byType: Object.fromEntries(CLAIM_TYPES.map((type) => [type, claims.filter((claim) => claim.type === type).length])) as Record<(typeof CLAIM_TYPES)[number], number>
  };
}
