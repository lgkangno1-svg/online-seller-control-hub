import { z } from "zod";
import { MARKETS } from "../core/types.js";

const productSchema = z.object({
  masterSku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  salePrice: z.number().int().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
  imageUrls: z.array(z.string().url()).max(20).default([]),
  categoryCode: z.string().trim().min(1).optional(),
  markets: z.record(z.string(), z.object({ externalId: z.string().optional() }).optional()).default({}),
});

export function buildListingReadinessReport(input: unknown) {
  const products = z.array(productSchema).max(5000).parse(input);
  return products.map((product) => {
    const issues: string[] = [];
    if (product.salePrice === undefined) issues.push("missing_sale_price");
    if (product.stock === undefined) issues.push("missing_stock");
    if (product.imageUrls.length === 0) issues.push("missing_image");
    if (!product.categoryCode) issues.push("missing_category");
    const connectedMarkets = MARKETS.filter((market) => Boolean(product.markets[market]?.externalId));
    return { masterSku: product.masterSku, ready: issues.length === 0, issues, connectedMarkets };
  });
}

export function summarizeListingReadiness(input: unknown) {
  const rows = buildListingReadinessReport(input);
  return { total: rows.length, ready: rows.filter((row) => row.ready).length, blocked: rows.filter((row) => !row.ready).length, issueCount: rows.reduce((sum, row) => sum + row.issues.length, 0) };
}
