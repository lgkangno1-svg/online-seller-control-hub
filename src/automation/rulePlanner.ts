import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";
import { ALERT_KINDS, operationsSignalsSchema, type OperationsSignal } from "./operationsAlert.js";

export const AUTOMATION_ACTIONS = ["notify_telegram", "request_review", "pause_listing", "set_stock_zero"] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

const automationRuleSchema = z.object({
  id: z.string().trim().min(1).max(100),
  kind: z.enum(ALERT_KINDS),
  market: z.enum(MARKETS).optional(),
  minCount: z.number().int().nonnegative().max(1_000_000).default(1),
  action: z.enum(AUTOMATION_ACTIONS),
  enabled: z.boolean().default(true),
  cooldownMinutes: z.number().int().nonnegative().max(10_080).default(60)
}).strict();

const automationRulesSchema = z.array(automationRuleSchema).max(200).superRefine((rules, ctx) => {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    if (seen.has(rule.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "duplicate automation rule id" });
    }
    seen.add(rule.id);

    const mutatesMarketplace = rule.action === "pause_listing" || rule.action === "set_stock_zero";
    if (mutatesMarketplace && rule.kind !== "stock_risk") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "action"], message: "marketplace mutation actions are only allowed for stock-risk rules" });
    }
    if (mutatesMarketplace && !rule.market) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "market"], message: "marketplace mutation rules require an explicit market" });
    }
  });
});

const automationPlannerInputSchema = z.object({
  rules: automationRulesSchema,
  signals: operationsSignalsSchema
}).strict();

export type AutomationRule = z.infer<typeof automationRuleSchema>;
export type AutomationProposal = {
  proposalId: string;
  ruleId: string;
  kind: OperationsSignal["kind"];
  market?: Market;
  action: AutomationAction;
  count: number;
  threshold: number;
  detectedAt: string;
  cooldownMinutes: number;
  requiresConfirmation: boolean;
  risk: "low" | "high";
};

function isMarketplaceMutation(action: AutomationAction): boolean {
  return action === "pause_listing" || action === "set_stock_zero";
}

/**
 * Evaluates read-only operational signals and emits at most one current proposal
 * per enabled rule. Marketplace mutations remain proposals only and require an
 * explicit approval/Telegram confirmation before any adapter execution.
 */
export function planAutomationActions(input: unknown): AutomationProposal[] {
  const parsed = automationPlannerInputSchema.parse(input);
  const proposals: AutomationProposal[] = [];

  for (const rule of parsed.rules) {
    if (!rule.enabled) continue;

    const matches = parsed.signals
      .filter((signal) => signal.kind === rule.kind)
      .filter((signal) => !rule.market || signal.market === rule.market)
      .filter((signal) => signal.count > 0 && signal.count >= signal.threshold && signal.count >= rule.minCount)
      .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt) || b.count - a.count);

    const signal = matches[0];
    if (!signal) continue;

    const mutation = isMarketplaceMutation(rule.action);
    const market = rule.market ?? signal.market;
    const proposal: AutomationProposal = {
      proposalId: `${rule.id}:${signal.detectedAt}`,
      ruleId: rule.id,
      kind: signal.kind,
      action: rule.action,
      count: signal.count,
      threshold: Math.max(signal.threshold, rule.minCount),
      detectedAt: signal.detectedAt,
      cooldownMinutes: rule.cooldownMinutes,
      requiresConfirmation: mutation,
      risk: mutation ? "high" : "low"
    };
    if (market) proposal.market = market;
    proposals.push(proposal);
  }

  return proposals.sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt) || a.ruleId.localeCompare(b.ruleId));
}

export function summarizeAutomationPlan(input: unknown) {
  const proposals = planAutomationActions(input);
  return {
    total: proposals.length,
    confirmationRequired: proposals.filter((proposal) => proposal.requiresConfirmation).length,
    notifications: proposals.filter((proposal) => proposal.action === "notify_telegram").length,
    marketplaceMutations: proposals.filter((proposal) => isMarketplaceMutation(proposal.action)).length
  };
}
