import { z } from "zod";
import { MARKETS, type Market, type ParsedCommand } from "./types.js";

const bulkControlItemSchema = z.object({
  masterSku: z.string().trim().min(1).max(120),
  action: z.enum(["SET_STOCK", "SET_PRICE", "SET_OUT_OF_STOCK", "STOP_SALES", "RESUME_SALES"]),
  value: z.number().int().nonnegative().nullable().default(null),
  markets: z.array(z.enum(MARKETS)).min(1).max(MARKETS.length)
}).superRefine((item, ctx) => {
  if ((item.action === "SET_STOCK" || item.action === "SET_PRICE") && item.value === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "value is required" });
  }
  if (item.action === "SET_PRICE" && item.value !== null && item.value < 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "price looks invalid" });
  }
});

const bulkControlSchema = z.array(bulkControlItemSchema).min(1).max(500).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.masterSku.trim().toLowerCase()}|${item.action}`;
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "duplicate SKU/action in bulk request" });
    seen.add(key);
  });
});

export type BulkControlItem = z.infer<typeof bulkControlItemSchema>;
export type BulkControlPlanRow = {
  masterSku: string;
  command: ParsedCommand;
  writeCount: number;
};
export type BulkControlPlan = {
  rows: BulkControlPlanRow[];
  totalProducts: number;
  totalWrites: number;
  markets: Market[];
  requiresConfirmation: true;
};

/**
 * Builds a bounded, reviewable bulk price/stock/sales plan without executing it.
 * Execution remains behind the existing approval/Telegram confirmation path.
 */
export function buildBulkControlPlan(input: unknown): BulkControlPlan {
  const items = bulkControlSchema.parse(input);
  const rows = items.map((item): BulkControlPlanRow => ({
    masterSku: item.masterSku,
    command: {
      action: item.action,
      productQuery: item.masterSku,
      markets: [...new Set(item.markets)],
      value: item.action === "SET_STOCK" || item.action === "SET_PRICE" ? item.value : null,
      rationale: "bulk control plan"
    },
    writeCount: new Set(item.markets).size
  }));
  const markets = [...new Set(rows.flatMap((row) => row.command.markets))];
  return {
    rows,
    totalProducts: rows.length,
    totalWrites: rows.reduce((sum, row) => sum + row.writeCount, 0),
    markets,
    requiresConfirmation: true
  };
}
