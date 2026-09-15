import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { type Market } from "../core/types.js";

const optionalId = z.string().trim().min(1).max(300).optional();
const marketMappingSchema = z.object({ externalId: optionalId, productId: optionalId }).superRefine((mapping, ctx) => {
  if (!mapping.externalId && !mapping.productId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "externalId or productId is required" });
});
const marketMapSchema = z.object({ naver: marketMappingSchema.optional(), coupang: marketMappingSchema.optional(), gmarket: marketMappingSchema.optional(), lotteon: marketMappingSchema.optional(), toss: marketMappingSchema.optional(), kakao: marketMappingSchema.optional() });
const productSchema = z.object({ tenantId: z.string().trim().min(1).max(100).default("demo"), masterSku: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(300), aliases: z.array(z.string().trim().min(1).max(300)).max(30).default([]), markets: marketMapSchema });
const catalogSchema = z.array(productSchema);
const writableProductSchema = productSchema.omit({ tenantId: true });
const bulkWritableProductSchema = z.array(writableProductSchema).min(1).max(1000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = normalize(item.masterSku);
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "masterSku"], message: "duplicate masterSku in bulk request" });
    seen.add(key);
  });
});

export type CatalogProduct = z.infer<typeof productSchema>;
export type WritableCatalogProduct = z.infer<typeof writableProductSchema>;
export type ResolveResult = { kind: "found"; product: CatalogProduct } | { kind: "ambiguous"; products: CatalogProduct[] } | { kind: "missing" };

export class ProductCatalog {
  private writeQueue: Promise<void> = Promise.resolve();
  private constructor(private readonly path: string, private products: CatalogProduct[]) {}

  static async load(path: string): Promise<ProductCatalog> {
    try { return new ProductCatalog(path, await readCatalog(path)); }
    catch (primaryError) {
      const primaryCode = errorCode(primaryError);
      try { const recovered = await readCatalog(backupPath(path)); await writeSnapshot(path, recovered); return new ProductCatalog(path, recovered); }
      catch (backupError) {
        if (primaryCode === "ENOENT" && errorCode(backupError) === "ENOENT") { await writeSnapshot(path, []); return new ProductCatalog(path, []); }
        throw primaryError;
      }
    }
  }

  list(tenantId = "demo"): CatalogProduct[] { return this.products.filter((p) => p.tenantId === tenantId).map(cloneProduct); }

  resolve(query: string, tenantId = "demo"): ResolveResult {
    const tenantProducts = this.products.filter((p) => p.tenantId === tenantId); const needle = normalize(query);
    const exact = tenantProducts.filter((p) => [p.masterSku, p.name, ...p.aliases].some((v) => normalize(v) === needle));
    if (exact.length === 1) return { kind: "found", product: cloneProduct(exact[0]!) };
    if (exact.length > 1) return { kind: "ambiguous", products: exact.map(cloneProduct) };
    const fuzzy = tenantProducts.filter((p) => [p.masterSku, p.name, ...p.aliases].some((v) => { const n = normalize(v); return n.includes(needle) || needle.includes(n); }));
    if (fuzzy.length === 1) return { kind: "found", product: cloneProduct(fuzzy[0]!) };
    if (fuzzy.length > 1) return { kind: "ambiguous", products: fuzzy.map(cloneProduct) };
    return { kind: "missing" };
  }

  async upsert(tenantId: string, input: unknown): Promise<CatalogProduct> {
    const [product] = await this.bulkUpsert(tenantId, [input]); return product!;
  }

  async bulkUpsert(tenantId: string, inputs: unknown[]): Promise<CatalogProduct[]> {
    const parsed = bulkWritableProductSchema.parse(inputs);
    const incoming = parsed.map((item) => productSchema.parse({ ...item, tenantId }));
    return this.enqueueMutation((products) => {
      const next = [...products];
      for (const product of incoming) {
        const index = next.findIndex((item) => item.tenantId === tenantId && normalize(item.masterSku) === normalize(product.masterSku));
        if (index >= 0) next[index] = product; else next.push(product);
      }
      return { products: next, result: incoming.map(cloneProduct) };
    });
  }

  async setMarketplaceProductId(tenantId: string, masterSku: string, market: Market, productId: string): Promise<CatalogProduct | null> { return this.setMarketplaceMapping(tenantId, masterSku, market, { productId }); }
  async setMarketplaceMapping(tenantId: string, masterSku: string, market: Market, patch: { productId?: string | null; externalId?: string | null }): Promise<CatalogProduct | null> {
    return this.enqueueMutation((products) => {
      const index = products.findIndex((p) => p.tenantId === tenantId && normalize(p.masterSku) === normalize(masterSku));
      if (index < 0) return { products, result: null, persist: false };
      const current = products[index]!; const previous = current.markets[market] ?? {};
      const nextMapping = { ...(previous.productId ? { productId: previous.productId } : {}), ...(previous.externalId ? { externalId: previous.externalId } : {}), ...(patch.productId === null ? {} : patch.productId ? { productId: patch.productId } : {}), ...(patch.externalId === null ? {} : patch.externalId ? { externalId: patch.externalId } : {}) };
      if (patch.productId === null) delete nextMapping.productId; if (patch.externalId === null) delete nextMapping.externalId;
      const updated = productSchema.parse({ ...current, markets: { ...current.markets, [market]: nextMapping } });
      return { products: products.map((p, i) => i === index ? updated : p), result: cloneProduct(updated) };
    });
  }

  async remove(tenantId: string, masterSku: string): Promise<boolean> {
    return this.enqueueMutation((products) => { const next = products.filter((p) => !(p.tenantId === tenantId && normalize(p.masterSku) === normalize(masterSku))); return next.length === products.length ? { products, result: false, persist: false } : { products: next, result: true }; });
  }
  externalId(product: CatalogProduct, market: Market): string | null { return product.markets[market]?.externalId ?? null; }
  productId(product: CatalogProduct, market: Market): string | null { return product.markets[market]?.productId ?? null; }

  private async enqueueMutation<T>(mutate: (products: CatalogProduct[]) => { products: CatalogProduct[]; result: T; persist?: boolean }): Promise<T> {
    const operation = this.writeQueue.then(async () => { const mutation = mutate(this.products); if (mutation.persist === false) return mutation.result; await this.persistProducts(mutation.products); this.products = mutation.products; return mutation.result; });
    this.writeQueue = operation.then(() => undefined, () => undefined); return operation;
  }
  private async persistProducts(products: CatalogProduct[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try { const current = await readFile(this.path, "utf8"); catalogSchema.parse(JSON.parse(current)); await writeRawFile(backupPath(this.path), current, "backup"); } catch (error) { if (errorCode(error) !== "ENOENT") { /* preserve backup */ } }
    await writeSnapshot(this.path, products);
  }
}

async function readCatalog(path: string): Promise<CatalogProduct[]> { return catalogSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
async function writeSnapshot(path: string, products: CatalogProduct[]): Promise<void> { await writeRawFile(path, `${JSON.stringify(products, null, 2)}\n`, "write"); }
async function writeRawFile(path: string, content: string, suffix: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporaryPath = `${path}.${process.pid}.${Date.now()}.${suffix}.tmp`; try { await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 }); await rename(temporaryPath, path); } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); } }
function backupPath(path: string): string { return `${path}.bak`; }
function errorCode(error: unknown): string { return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""; }
function cloneProduct(product: CatalogProduct): CatalogProduct { return { ...product, aliases: [...product.aliases], markets: Object.fromEntries(Object.entries(product.markets).map(([market, mapping]) => [market, mapping ? { ...mapping } : mapping])) as CatalogProduct["markets"] }; }
function normalize(value: string): string { return value.toLowerCase().replace(/\s+/g, "").trim(); }
