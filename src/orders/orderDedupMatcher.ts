import { z } from "zod";
import { MARKETS } from "../core/types.js";

const candidateSchema = z.object({
  market: z.enum(MARKETS),
  externalOrderId: z.string().trim().min(1).max(120),
  externalOrderLineId: z.string().trim().min(1).max(120),
  masterSku: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().int().positive(),
  orderedAt: z.string().datetime({ offset: true })
});

export type OrderDedupCandidate = z.infer<typeof candidateSchema>;

export function matchDuplicateOrders(input: unknown) {
  const rows = z.array(candidateSchema).max(10000).parse(input);
  const exact = new Map<string, OrderDedupCandidate[]>();
  const fingerprints = new Map<string, OrderDedupCandidate[]>();
  for (const row of rows) {
    const key = `${row.market}:${row.externalOrderLineId}`;
    exact.set(key, [...(exact.get(key) ?? []), row]);
    if (row.masterSku) {
      const minute = row.orderedAt.slice(0, 16);
      const fp = `${row.market}:${row.externalOrderId}:${row.masterSku}:${row.quantity}:${minute}`;
      fingerprints.set(fp, [...(fingerprints.get(fp) ?? []), row]);
    }
  }
  return {
    exactDuplicates: [...exact.entries()].filter(([, items]) => items.length > 1).map(([key, items]) => ({ key, count: items.length })),
    suspiciousDuplicates: [...fingerprints.entries()].filter(([, items]) => items.length > 1).map(([fingerprint, items]) => ({ fingerprint, count: items.length })),
    uniqueLines: exact.size,
    totalLines: rows.length
  };
}
