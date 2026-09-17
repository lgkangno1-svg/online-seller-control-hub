import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";
import { CLAIM_STATUSES, CLAIM_TYPES } from "../orders/claimInbox.js";

export const CLAIM_ACTIONS = [
  "approve",
  "reject",
  "request_collection",
  "mark_collected",
  "ship_replacement",
  "complete"
] as const;

export type ClaimAction = (typeof CLAIM_ACTIONS)[number];
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const claimActionRequestSchema = z.object({
  market: z.enum(MARKETS),
  externalClaimId: z.string().trim().min(1).max(120),
  orderLineId: z.string().trim().min(1).max(120),
  type: z.enum(CLAIM_TYPES),
  status: z.enum(CLAIM_STATUSES),
  action: z.enum(CLAIM_ACTIONS),
  note: z.string().trim().min(1).max(500).optional()
}).strict();

export type ClaimActionRequest = z.infer<typeof claimActionRequestSchema>;
export type ClaimActionPlanItem = ClaimActionRequest & {
  requiresConfirmation: true;
  risk: "medium" | "high";
};

function allowedActions(type: ClaimType, status: ClaimStatus): readonly ClaimAction[] {
  if (status === "completed" || status === "rejected") return [];

  if (status === "requested") {
    if (type === "cancel") return ["approve", "reject"];
    return ["approve", "reject", "request_collection"];
  }

  if (type === "cancel") return ["complete", "reject"];
  if (type === "return") return ["mark_collected", "complete", "reject"];
  return ["mark_collected", "ship_replacement", "complete", "reject"];
}

function riskFor(action: ClaimAction): ClaimActionPlanItem["risk"] {
  return action === "request_collection" || action === "mark_collected" ? "medium" : "high";
}

export const claimActionRequestsSchema = z.array(claimActionRequestSchema).max(500).superRefine((items, ctx) => {
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalClaimId}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalClaimId"], message: "duplicate marketplace claim action" });
    }
    seen.add(key);

    if (!allowedActions(item.type, item.status).includes(item.action)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "action"], message: "action is not allowed for the current claim type/status" });
    }

    if (item.action === "reject" && !item.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "note"], message: "rejection requires a reason note" });
    }
  });
});

/**
 * Builds an approval-only claim mutation plan. This function never performs a
 * marketplace write; every planned cancel/return/exchange action must still be
 * explicitly confirmed before an adapter is allowed to execute it.
 */
export function planClaimActions(input: unknown): ClaimActionPlanItem[] {
  return claimActionRequestsSchema.parse(input).map((item) => ({
    ...item,
    requiresConfirmation: true,
    risk: riskFor(item.action)
  }));
}

export function summarizeClaimActionPlan(input: unknown) {
  const items = planClaimActions(input);
  const byMarket = {} as Record<string, number>;
  let highRisk = 0;

  for (const item of items) {
    byMarket[item.market] = (byMarket[item.market] ?? 0) + 1;
    if (item.risk === "high") highRisk += 1;
  }

  return {
    total: items.length,
    highRisk,
    mediumRisk: items.length - highRisk,
    confirmationRequired: items.length,
    byMarket: byMarket as Partial<Record<Market, number>>
  };
}
