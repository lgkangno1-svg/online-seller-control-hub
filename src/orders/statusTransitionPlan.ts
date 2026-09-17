import { z } from "zod";
import { MARKETS } from "../core/types.js";
import { ORDER_STATUSES } from "./orderInbox.js";

const transitionSchema = z.object({
  market: z.enum(MARKETS),
  externalOrderLineId: z.string().trim().min(1).max(120),
  fromStatus: z.enum(ORDER_STATUSES),
  toStatus: z.enum(ORDER_STATUSES),
  reason: z.string().trim().min(1).max(300).optional()
});

const inputSchema = z.array(transitionSchema).max(1000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalOrderLineId}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalOrderLineId"], message: "duplicate order transition" });
    seen.add(key);
  });
});

const allowed: Record<(typeof ORDER_STATUSES)[number], readonly (typeof ORDER_STATUSES)[number][]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};

export type OrderStatusTransition = z.infer<typeof transitionSchema>;

/** Review-only plan: marketplace writes must be executed by an approved workflow. */
export function planOrderStatusTransitions(input: unknown) {
  const transitions = inputSchema.parse(input);
  return transitions.map((item) => {
    if (item.fromStatus === item.toStatus) throw new Error(`no-op order transition: ${item.externalOrderLineId}`);
    if (!allowed[item.fromStatus].includes(item.toStatus)) throw new Error(`invalid order transition: ${item.fromStatus} -> ${item.toStatus}`);
    const destructive = item.toStatus === "cancelled";
    return { ...item, requiresConfirmation: true, risk: destructive ? "high" as const : "normal" as const };
  });
}

export function summarizeOrderStatusPlan(input: unknown) {
  const items = planOrderStatusTransitions(input);
  return {
    total: items.length,
    highRisk: items.filter((item) => item.risk === "high").length,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, items.filter((item) => item.market === market).length]))
  };
}
