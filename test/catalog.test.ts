import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductCatalog } from "../src/catalog/catalog.js";

async function makeCatalog() {
  const dir = await mkdtemp(join(tmpdir(), "seller-catalog-")); const path = join(dir, "products.json");
  await writeFile(path, JSON.stringify([
    { tenantId: "tenant-a", masterSku: "APPLE-A", name: "홍옥 사과 5kg", aliases: ["홍옥5kg"], markets: { naver: { externalId: "A1" } } },
    { tenantId: "tenant-b", masterSku: "APPLE-B", name: "홍옥 사과 5kg", aliases: ["홍옥5kg"], markets: { coupang: { externalId: "B1" } } }
  ])); return { catalog: await ProductCatalog.load(path), path };
}

test("catalog resolves a unique alias inside one tenant", async () => { const { catalog } = await makeCatalog(); const result = catalog.resolve("홍옥 5kg", "tenant-a"); assert.equal(result.kind, "found"); if (result.kind === "found") assert.equal(result.product.masterSku, "APPLE-A"); });
test("catalog never leaks another tenant product", async () => { const { catalog } = await makeCatalog(); assert.deepEqual(catalog.list("tenant-a").map((p) => p.masterSku), ["APPLE-A"]); assert.equal(catalog.resolve("APPLE-B", "tenant-a").kind, "missing"); });
test("tenant can upsert its own mapping and it persists to disk", async () => { const { catalog, path } = await makeCatalog(); await catalog.upsert("tenant-a", { masterSku: "APPLE-A", name: "홍옥 사과 특품 5kg", aliases: ["홍옥특품"], markets: { naver: { externalId: "A2" }, gmarket: { externalId: "G2" } } }); const reloaded = await ProductCatalog.load(path); const updated = reloaded.resolve("APPLE-A", "tenant-a"); assert.equal(updated.kind, "found"); if (updated.kind === "found") assert.equal(updated.product.markets.gmarket?.externalId, "G2"); });
test("tenant delete cannot delete another tenant product", async () => { const { catalog } = await makeCatalog(); assert.equal(await catalog.remove("tenant-a", "APPLE-B"), false); assert.equal(await catalog.remove("tenant-a", "APPLE-A"), true); });

test("bulk upsert atomically updates and creates products without crossing tenants", async () => {
  const { catalog, path } = await makeCatalog();
  const result = await catalog.bulkUpsert("tenant-a", [
    { masterSku: "APPLE-A", name: "홍옥 사과 5kg 특품", aliases: [], markets: { naver: { externalId: "A9" } } },
    { masterSku: "PEAR-A", name: "신고배 5kg", aliases: ["배5kg"], markets: { coupang: { productId: "CP-PEAR" } } }
  ]);
  assert.deepEqual(result.map((p) => p.masterSku), ["APPLE-A", "PEAR-A"]);
  const reloaded = await ProductCatalog.load(path);
  assert.deepEqual(reloaded.list("tenant-a").map((p) => p.masterSku).sort(), ["APPLE-A", "PEAR-A"]);
  assert.equal(reloaded.resolve("APPLE-B", "tenant-b").kind, "found");
});

test("bulk upsert rejects duplicate SKU before changing durable state", async () => {
  const { catalog, path } = await makeCatalog(); const before = await readFile(path, "utf8");
  await assert.rejects(() => catalog.bulkUpsert("tenant-a", [
    { masterSku: "DUP", name: "상품1", aliases: [], markets: { naver: { externalId: "1" } } },
    { masterSku: " dup ", name: "상품2", aliases: [], markets: { naver: { externalId: "2" } } }
  ]));
  assert.equal(await readFile(path, "utf8"), before);
});
