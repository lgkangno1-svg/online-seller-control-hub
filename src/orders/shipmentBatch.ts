import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const shipmentSchema = z.object({
  market: z.enum(MARKETS),
  orderLineId: z.string().trim().min(1).max(120),
  carrierCode: z.string().trim().min(1).max(40),
  trackingNumber: z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9-]+$/, "tracking number contains unsupported characters")
});

export type ShipmentInput = z.infer<typeof shipmentSchema>;
export type ShipmentMarketBatch = { market: Market; items: ShipmentInput[] };
export type ShipmentApiBatch = ShipmentMarketBatch & { batchIndex: number; batchCount: number; retryKey: string };

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

/**
 * Validates once, then groups shipment updates by marketplace while preserving
 * input order. Marketplace adapters can consume these bounded groups without
 * accidentally sending another marketplace's order IDs to the wrong API.
 */
export function groupShipmentBatchByMarket(input: unknown): ShipmentMarketBatch[] {
  const items = validateShipmentBatch(input);
  const grouped = new Map<Market, ShipmentInput[]>();
  for (const item of items) {
    const marketItems = grouped.get(item.market);
    if (marketItems) marketItems.push(item);
    else grouped.set(item.market, [item]);
  }
  return [...grouped.entries()].map(([market, marketItems]) => ({ market, items: marketItems }));
}

/**
 * Converts a mixed shipment import into bounded marketplace API calls. Keeping
 * chunking here prevents adapters from silently truncating oversized batches
 * and makes partial-failure retry boundaries explicit to callers. retryKey is
 * deterministic so a worker can persist the last successful chunk and resume
 * without replaying earlier marketplace writes.
 */
export function chunkShipmentBatchByMarket(input: unknown, maxItemsPerCall = 50): ShipmentApiBatch[] {
  if (!Number.isSafeInteger(maxItemsPerCall) || maxItemsPerCall < 1 || maxItemsPerCall > 500) {
    throw new Error("maxItemsPerCall must be an integer between 1 and 500");
  }

  const result: ShipmentApiBatch[] = [];
  for (const group of groupShipmentBatchByMarket(input)) {
    const batchCount = Math.ceil(group.items.length / maxItemsPerCall);
    for (let offset = 0, batchIndex = 0; offset < group.items.length; offset += maxItemsPerCall, batchIndex += 1) {
      result.push({
        market: group.market,
        items: group.items.slice(offset, offset + maxItemsPerCall),
        batchIndex,
        batchCount,
        retryKey: `${group.market}:${batchIndex + 1}/${batchCount}`
      });
    }
  }
  return result;
}

/** Returns only chunks after the last confirmed marketplace write. */
export function resumeShipmentApiBatches(batches: ShipmentApiBatch[], lastSuccessfulRetryKey?: string): ShipmentApiBatch[] {
  if (!lastSuccessfulRetryKey) return batches;
  const index = batches.findIndex((batch) => batch.retryKey === lastSuccessfulRetryKey);
  if (index < 0) throw new Error("last successful shipment retry key does not belong to this batch plan");
  return batches.slice(index + 1);
}
