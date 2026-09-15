import { createHash } from "node:crypto";
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

function shipmentChunkFingerprint(items: ShipmentInput[]): string {
  return createHash("sha256")
    .update(JSON.stringify(items.map(({ market, orderLineId, carrierCode, trackingNumber }) => [market, orderLineId, carrierCode, trackingNumber])))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Converts a mixed shipment import into bounded marketplace API calls. retryKey
 * includes a payload fingerprint so a checkpoint from an edited shipment plan
 * cannot silently skip different marketplace writes.
 */
export function chunkShipmentBatchByMarket(input: unknown, maxItemsPerCall = 50): ShipmentApiBatch[] {
  if (!Number.isSafeInteger(maxItemsPerCall) || maxItemsPerCall < 1 || maxItemsPerCall > 500) {
    throw new Error("maxItemsPerCall must be an integer between 1 and 500");
  }

  const result: ShipmentApiBatch[] = [];
  for (const group of groupShipmentBatchByMarket(input)) {
    const batchCount = Math.ceil(group.items.length / maxItemsPerCall);
    for (let offset = 0, batchIndex = 0; offset < group.items.length; offset += maxItemsPerCall, batchIndex += 1) {
      const items = group.items.slice(offset, offset + maxItemsPerCall);
      result.push({
        market: group.market,
        items,
        batchIndex,
        batchCount,
        retryKey: `${group.market}:${batchIndex + 1}/${batchCount}:${shipmentChunkFingerprint(items)}`
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
