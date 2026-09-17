import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const pickPackLineSchema = z.object({
  market: z.enum(MARKETS),
  externalOrderId: z.string().trim().min(1).max(120),
  externalOrderLineId: z.string().trim().min(1).max(120),
  masterSku: z.string().trim().min(1).max(120).optional(),
  productName: z.string().trim().min(1).max(300),
  quantity: z.number().int().positive().max(100000),
  status: z.enum(["confirmed", "preparing"])
}).strict();

const pickPackWaveSchema = z.array(pickPackLineSchema).max(1000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalOrderLineId}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalOrderLineId"], message: "duplicate marketplace order line" });
    }
    seen.add(key);
  });
});

export type PickPackLine = z.infer<typeof pickPackLineSchema>;
export type PickListItem = {
  masterSku: string;
  productName: string;
  totalUnits: number;
  orderLineCount: number;
  markets: Partial<Record<Market, number>>;
};

export type PickPackWave = {
  readyLines: PickPackLine[];
  blockedUnmappedLines: PickPackLine[];
  pickList: PickListItem[];
  summary: {
    totalLines: number;
    readyLines: number;
    blockedUnmappedLines: number;
    readyUnits: number;
    uniqueSkus: number;
  };
};

/**
 * Builds a read-only warehouse wave from confirmed/preparing order lines. It
 * excludes unmapped SKUs from the pick list rather than guessing a product,
 * and it contains no buyer/receiver data or marketplace mutations.
 */
export function buildPickPackWave(input: unknown): PickPackWave {
  const lines = pickPackWaveSchema.parse(input);
  const readyLines = lines.filter((line) => Boolean(line.masterSku));
  const blockedUnmappedLines = lines.filter((line) => !line.masterSku);
  const grouped = new Map<string, PickListItem>();

  for (const line of readyLines) {
    const masterSku = line.masterSku!;
    const existing = grouped.get(masterSku) ?? {
      masterSku,
      productName: line.productName,
      totalUnits: 0,
      orderLineCount: 0,
      markets: {}
    };
    existing.totalUnits += line.quantity;
    existing.orderLineCount += 1;
    existing.markets[line.market] = (existing.markets[line.market] ?? 0) + line.quantity;
    grouped.set(masterSku, existing);
  }

  const pickList = [...grouped.values()].sort((a, b) => a.masterSku.localeCompare(b.masterSku));
  return {
    readyLines,
    blockedUnmappedLines,
    pickList,
    summary: {
      totalLines: lines.length,
      readyLines: readyLines.length,
      blockedUnmappedLines: blockedUnmappedLines.length,
      readyUnits: readyLines.reduce((sum, line) => sum + line.quantity, 0),
      uniqueSkus: pickList.length
    }
  };
}
