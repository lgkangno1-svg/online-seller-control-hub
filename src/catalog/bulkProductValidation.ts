import { z } from "zod";

const productSchema = z.object({ masterSku: z.string().trim().min(1).max(120), name: z.string().trim().min(2).max(300), price: z.number().int().positive(), stock: z.number().int().nonnegative(), imageUrl: z.string().url().optional(), categoryId: z.string().trim().min(1).optional() });

export function validateBulkProducts(input: unknown) {
  const rows = z.array(z.unknown()).max(5000).parse(input);
  const seen = new Set<string>();
  return rows.map((raw, index) => {
    const parsed = productSchema.safeParse(raw);
    if (!parsed.success) return { row: index + 1, valid: false as const, errors: parsed.error.issues.map((i) => i.message) };
    const key = parsed.data.masterSku.toLowerCase();
    if (seen.has(key)) return { row: index + 1, valid: false as const, errors: ["duplicate masterSku"] };
    seen.add(key);
    const warnings = [...(!parsed.data.imageUrl ? ["missing image"] : []), ...(!parsed.data.categoryId ? ["missing category"] : [])];
    return { row: index + 1, valid: true as const, product: parsed.data, warnings };
  });
}

export function summarizeBulkProductValidation(input: unknown) {
  const rows = validateBulkProducts(input);
  return { total: rows.length, valid: rows.filter((r) => r.valid).length, invalid: rows.filter((r) => !r.valid).length, warnings: rows.reduce((n, r) => n + (r.valid ? r.warnings.length : 0), 0) };
}
