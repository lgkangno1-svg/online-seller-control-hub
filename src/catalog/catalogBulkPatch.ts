import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const mappingPatchSchema = z.object({
  market: z.enum(MARKETS),
  productId: z.string().trim().min(1).max(300).nullable().optional(),
  externalId: z.string().trim().min(1).max(300).nullable().optional()
}).refine((value) => value.productId !== undefined || value.externalId !== undefined, "mapping patch is empty");

const rowSchema = z.object({
  masterSku: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(300).optional(),
  aliases: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  mappings: z.array(mappingPatchSchema).max(MARKETS.length).default([])
}).refine((row) => row.name !== undefined || row.aliases !== undefined || row.mappings.length > 0, "product patch is empty");

const requestSchema = z.array(rowSchema).min(1).max(500).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.masterSku.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "masterSku"], message: "duplicate masterSku" });
    seen.add(key);
    const markets = new Set<Market>();
    row.mappings.forEach((mapping, mappingIndex) => {
      if (markets.has(mapping.market)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "mappings", mappingIndex], message: "duplicate market mapping" });
      markets.add(mapping.market);
    });
  });
});

export type CatalogBulkPatchRow = z.infer<typeof rowSchema>;
export type CatalogBulkPatchPlan = {
  rows: CatalogBulkPatchRow[];
  totalProducts: number;
  totalFieldChanges: number;
  mappingChanges: number;
  markets: Market[];
  requiresConfirmation: true;
};

/** Builds a bounded review plan for spreadsheet-style product edits; it never mutates the catalog. */
export function buildCatalogBulkPatchPlan(input: unknown): CatalogBulkPatchPlan {
  const rows = requestSchema.parse(input);
  const mappingChanges = rows.reduce((sum, row) => sum + row.mappings.length, 0);
  const totalFieldChanges = rows.reduce((sum, row) => sum + (row.name === undefined ? 0 : 1) + (row.aliases === undefined ? 0 : 1) + row.mappings.length, 0);
  return {
    rows,
    totalProducts: rows.length,
    totalFieldChanges,
    mappingChanges,
    markets: [...new Set(rows.flatMap((row) => row.mappings.map((mapping) => mapping.market)))],
    requiresConfirmation: true
  };
}
