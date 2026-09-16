import { z } from "zod";
import { MARKETS } from "../core/types.js";

export const CLAIM_TYPES = ["cancel", "return", "exchange"] as const;
export const CLAIM_STATUSES = ["requested", "accepted", "collecting", "completed", "rejected"] as const;

const claimSchema = z.object({
  market: z.enum(MARKETS),
  externalClaimId: z.string().trim().min(1).max(120),
  externalOrderLineId: z.string().trim().min(1).max(120),
  type: z.enum(CLAIM_TYPES),
  status: z.enum(CLAIM_STATUSES),
  reason: z.string().trim().min(1).max(500).optional(),
  requestedAt: z.string().datetime({ offset: true }),
});

export const claimInboxSchema = z.array(claimSchema).max(5000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalClaimId}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalClaimId"], message: "duplicate marketplace claim" });
    seen.add(key);
  });
});

export function normalizeClaimInbox(input: unknown) {
  return claimInboxSchema.parse(input).sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export function summarizeClaimInbox(input: unknown) {
  const claims = normalizeClaimInbox(input);
  return { total: claims.length, actionable: claims.filter((claim) => claim.status === "requested").length, byType: Object.fromEntries(CLAIM_TYPES.map((type) => [type, claims.filter((claim) => claim.type === type).length])) as Record<(typeof CLAIM_TYPES)[number], number> };
}
