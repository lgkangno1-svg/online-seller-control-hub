import { createHash } from "node:crypto";
import type { Market } from "../core/types.js";
import { chunkShipmentBatchByMarket, resumeShipmentApiBatches, type ShipmentApiBatch } from "./shipmentBatch.js";

export type ShipmentExecutionPreview = {
  confirmationKey: string;
  totalItems: number;
  totalApiCalls: number;
  markets: Array<{ market: Market; items: number; apiCalls: number }>;
};

export type ShipmentExecutionPlan = ShipmentExecutionPreview & {
  confirmed: true;
  pendingApiCalls: number;
  batches: ShipmentApiBatch[];
};

function summarize(batches: ShipmentApiBatch[]) {
  const marketSummary = new Map<Market, { items: number; apiCalls: number }>();
  for (const batch of batches) {
    const current = marketSummary.get(batch.market) ?? { items: 0, apiCalls: 0 };
    current.items += batch.items.length;
    current.apiCalls += 1;
    marketSummary.set(batch.market, current);
  }
  return {
    totalItems: batches.reduce((sum, batch) => sum + batch.items.length, 0),
    totalApiCalls: batches.length,
    markets: [...marketSummary.entries()].map(([market, summary]) => ({ market, ...summary }))
  };
}

function confirmationKeyFor(batches: ShipmentApiBatch[]): string {
  return `shipment:${createHash("sha256").update(batches.map((batch) => batch.retryKey).join("\n")).digest("hex").slice(0, 24)}`;
}

function pendingBatchesFor(input: {
  batches: ShipmentApiBatch[];
  lastSuccessfulRetryKey?: string | undefined;
  completedRetryKeys?: string[] | undefined;
}): ShipmentApiBatch[] {
  if (input.lastSuccessfulRetryKey && input.completedRetryKeys?.length) {
    throw new Error("use either lastSuccessfulRetryKey or completedRetryKeys, not both");
  }
  if (!input.completedRetryKeys?.length) return resumeShipmentApiBatches(input.batches, input.lastSuccessfulRetryKey);

  const validKeys = new Set(input.batches.map((batch) => batch.retryKey));
  const completed = new Set<string>();
  for (const key of input.completedRetryKeys) {
    if (!validKeys.has(key)) throw new Error("completed shipment retry key does not belong to this batch plan");
    if (completed.has(key)) throw new Error("completed shipment retry keys must be unique");
    completed.add(key);
  }
  return input.batches.filter((batch) => !completed.has(batch.retryKey));
}

/**
 * Produces a read-only preview that can be shown in the UI/Telegram confirmation.
 * The confirmation key is bound to the exact validated payload and chunking plan,
 * so editing a tracking number, order line, market, or API batch size invalidates it.
 */
export function buildShipmentExecutionPreview(input: { shipments: unknown; maxItemsPerCall?: number }): ShipmentExecutionPreview {
  const batches = chunkShipmentBatchByMarket(input.shipments, input.maxItemsPerCall ?? 50);
  return { confirmationKey: confirmationKeyFor(batches), ...summarize(batches) };
}

/**
 * Builds a bounded, resumable shipment plan without performing marketplace writes.
 * Shipment/invoice changes are externally visible, so the explicit confirmation
 * must carry the payload-bound key previously produced by the preview step.
 * completedRetryKeys supports partial/out-of-order successes without incorrectly
 * treating earlier failed marketplace calls as successful.
 */
export function buildShipmentExecutionPlan(input: {
  shipments: unknown;
  confirmed: boolean;
  confirmedPlanKey?: string;
  maxItemsPerCall?: number;
  lastSuccessfulRetryKey?: string;
  completedRetryKeys?: string[];
}): ShipmentExecutionPlan {
  if (input.confirmed !== true) throw new Error("shipment execution requires explicit confirmation");

  const allBatches = chunkShipmentBatchByMarket(input.shipments, input.maxItemsPerCall ?? 50);
  const confirmationKey = confirmationKeyFor(allBatches);
  if (!input.confirmedPlanKey || input.confirmedPlanKey !== confirmationKey) {
    throw new Error("shipment confirmation does not match the current payload; preview and confirm this exact shipment plan again");
  }

  const batches = pendingBatchesFor({
    batches: allBatches,
    lastSuccessfulRetryKey: input.lastSuccessfulRetryKey,
    completedRetryKeys: input.completedRetryKeys
  });
  return {
    confirmed: true,
    confirmationKey,
    ...summarize(allBatches),
    pendingApiCalls: batches.length,
    batches
  };
}
