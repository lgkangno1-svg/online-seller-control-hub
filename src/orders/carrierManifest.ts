import { z } from "zod";
import { MARKETS } from "../core/types.js";

const rowSchema = z.object({ market: z.enum(MARKETS), externalOrderLineId: z.string().trim().min(1).max(120), carrierCode: z.string().trim().min(1).max(40), invoiceNumber: z.string().trim().min(6).max(80), shippedAt: z.string().datetime({ offset: true }) });

export function buildCarrierManifest(input: unknown) {
  const rows = z.array(rowSchema).max(5000).parse(input);
  const seen = new Set<string>();
  return rows.map((row) => {
    const key = `${row.market}:${row.externalOrderLineId}`;
    if (seen.has(key)) throw new Error(`duplicate shipment line: ${key}`);
    seen.add(key);
    return { ...row, requiresConfirmation: true as const, risk: "normal" as const };
  });
}

export function summarizeCarrierManifest(input: unknown) {
  const rows = buildCarrierManifest(input);
  return { total: rows.length, byCarrier: rows.reduce<Record<string, number>>((acc, row) => { acc[row.carrierCode] = (acc[row.carrierCode] ?? 0) + 1; return acc; }, {}) };
}
