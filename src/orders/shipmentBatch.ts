import { z } from "zod";
import { MARKETS } from "../core/types.js";

const shipmentSchema = z.object({
  market: z.enum(MARKETS),
  orderLineId: z.string().trim().min(1).max(120),
  carrierCode: z.string().trim().min(1).max(40),
  trackingNumber: z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9-]+$/, "tracking number contains unsupported characters")
});

export type ShipmentInput = z.infer<typeof shipmentSchema>;

export const shipmentBatchSchema = z.array(shipmentSchema).min(1).max(500).superRefine((items, ctx) => {
  const orderLines = new Set<string>();
  const trackingAssignments = new Map<string, string>();

  items.forEach((item, index) => {
    const orderKey = `${item.market}:${item.orderLineId}`;
    if (orderLines.has(orderKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "orderLineId"], message: "duplicate order line in shipment batch" });
    }
    orderLines.add(orderKey);

    const trackingKey = `${item.market}:${item.carrierCode}:${item.trackingNumber}`;
    const previousOrder = trackingAssignments.get(trackingKey);
    if (previousOrder && previousOrder !== item.orderLineId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "trackingNumber"], message: "tracking number is assigned to multiple order lines" });
    } else {
      trackingAssignments.set(trackingKey, item.orderLineId);
    }
  });
});

export function validateShipmentBatch(input: unknown): ShipmentInput[] {
  return shipmentBatchSchema.parse(input);
}
