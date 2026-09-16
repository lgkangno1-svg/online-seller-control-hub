import { z } from "zod";
import { MARKETS } from "../core/types.js";

export const shippingPlanItemSchema = z.object({
  market: z.enum(MARKETS),
  externalOrderLineId: z.string().trim().min(1).max(120),
  carrierCode: z.string().trim().min(1).max(40),
  trackingNumber: z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9-]+$/),
});

export const shippingPlanSchema = z.array(shippingPlanItemSchema).min(1).max(500).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalOrderLineId}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalOrderLineId"], message: "duplicate order line" });
    seen.add(key);
  });
});

export type ShippingPlanItem = z.infer<typeof shippingPlanItemSchema>;

/** Builds a bounded shipment/invoice plan only; marketplace writes require the existing approval path. */
export function buildShippingPlan(input: unknown) {
  const items = shippingPlanSchema.parse(input);
  return {
    action: "register_shipment" as const,
    requiresApproval: true as const,
    count: items.length,
    markets: [...new Set(items.map((item) => item.market))],
    items,
  };
}
