import type { Market } from "../core/types.js";
import { chunkShipmentBatchByMarket, resumeShipmentApiBatches, type ShipmentApiBatch } from "./shipmentBatch.js";

export type ShipmentExecutionPlan = {
  confirmed: true;
  totalItems: number;
  totalApiCalls: number;
  pendingApiCalls: number;
  markets: Array<{ market: Market; items: number; apiCalls: number }>;
  batches: ShipmentApiBatch[];
};

/**
 * Builds a bounded, resumable shipment plan without performing marketplace writes.
 * Shipment/invoice changes are externally visible, so callers must collect explicit
 * confirmation before they can obtain an executable plan.
 */
export function buildShipmentExecutionPlan(input: {
  shipments: unknown;
  confirmed: boolean;
  maxItemsPerCall?: number;
  lastSuccessfulRetryKey?: string;
}): ShipmentExecutionPlan {
  if (input.confirmed !== true) {
    throw new Error("shipment execution requires explicit confirmation");
  }

  const allBatches = chunkShipmentBatchByMarket(input.shipments, input.maxItemsPerCall ?? 50);
  const batches = resumeShipmentApiBatches(allBatches, input.lastSuccessfulRetryKey);
  const marketSummary = new Map<Market, { items: number; apiCalls: number }>();

  for (const batch of allBatches) {
    const current = marketSummary.get(batch.market) ?? { items: 0, apiCalls: 0 };
    current.items += batch.items.length;
    current.apiCalls += 1;
    marketSummary.set(batch.market, current);
  }

  return {
    confirmed: true,
    totalItems: allBatches.reduce((sum, batch) => sum + batch.items.length, 0),
    totalApiCalls: allBatches.length,
    pendingApiCalls: batches.length,
    markets: [...marketSummary.entries()].map(([market, summary]) => ({ market, ...summary })),
    batches
  };
}
