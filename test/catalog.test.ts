import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductCatalog } from "../src/catalog/catalog.js";

async function makeCatalog() {
  const dir = await mkdtemp(join(tmpdir(), "seller-catalog-"));
  const path = join(dir, "products.json");
  await writeFile(path, JSON.stringify([
    { tenantId: "tenant-a", masterSku: "APPLE-A", name: "홍옥 사과 5kg", aliases: ["홍옥5kg"], markets: { naver: { externalId: "A1" } } },
    { tenantId: "tenant-b", masterSku: "APPLE-B", name: "홍옥 사과 5kg", aliases: ["홍옥5kg"], markets: { coupang: { externalId: "B1" } } }
  ]));
  return { catalog: await ProductCatalog.load(path), path };
}

test("catalog resolves a unique alias inside one tenant", async () => {
  const { catalog } = await makeCatalog();
  const result = catalog.resolve("홍옥 5kg", "tenant-a");
  assert.equal(result.kind, "found");
  if (result.kind === "found") assert.equal(result.product.masterSku, "APPLE-A");
});

test("catalog never leaks another tenant product", async () => {
  const { catalog } = await makeCatalog();
  assert.deepEqual(catalog.list("tenant-a").map((product) => product.masterSku), ["APPLE-A"]);
  assert.deepEqual(catalog.list("tenant-b").map((product) => product.masterSku), ["APPLE-B"]);
  assert.equal(catalog.resolve("APPLE-B", "tenant-a").kind, "missing");
  assert.equal(catalog.resolve("APPLE-A", "tenant-b").kind, "missing");
});

test("tenant can upsert its own mapping and it persists to disk", async () => {
  const { catalog, path } = await makeCatalog();
  await catalog.upsert("tenant-a", {
    masterSku: "APPLE-A",
    name: "홍옥 사과 특품 5kg",
    aliases: ["홍옥특품"],
    markets: {
      naver: { externalId: "A2" },
      gmarket: { externalId: "G2" }
    }
  });

  const reloaded = await ProductCatalog.load(path);
  const updated = reloaded.resolve("APPLE-A", "tenant-a");
  assert.equal(updated.kind, "found");
  if (updated.kind === "found") {
    assert.equal(updated.product.name, "홍옥 사과 특품 5kg");
    assert.equal(updated.product.markets.naver?.externalId, "A2");
    assert.equal(updated.product.markets.gmarket?.externalId, "G2");
  }
  assert.equal(reloaded.resolve("APPLE-B", "tenant-a").kind, "missing");
});

test("tenant delete cannot delete another tenant product", async () => {
  const { catalog, path } = await makeCatalog();
  assert.equal(await catalog.remove("tenant-a", "APPLE-B"), false);
  assert.equal(await catalog.remove("tenant-a", "APPLE-A"), true);

  const reloaded = await ProductCatalog.load(path);
  assert.equal(reloaded.resolve("APPLE-A", "tenant-a").kind, "missing");
  assert.equal(reloaded.resolve("APPLE-B", "tenant-b").kind, "found");
});

test("catalog recovers a corrupted primary from its last-known-good backup", async () => {
  const { catalog, path } = await makeCatalog();
  await catalog.upsert("tenant-a", {
    masterSku: "APPLE-A",
    name: "홍옥 사과 백업본",
    aliases: ["backup"],
    markets: { naver: { externalId: "A2" } }
  });
  await catalog.upsert("tenant-a", {
    masterSku: "APPLE-A",
    name: "홍옥 사과 최신본",
    aliases: ["latest"],
    markets: { naver: { externalId: "A3" } }
  });

  const backup = JSON.parse(await readFile(`${path}.bak`, "utf8")) as Array<{ name: string }>;
  assert.equal(backup.find((item) => item.name === "홍옥 사과 백업본")?.name, "홍옥 사과 백업본");

  await writeFile(path, "{broken", "utf8");
  const recovered = await ProductCatalog.load(path);
  const result = recovered.resolve("APPLE-A", "tenant-a");
  assert.equal(result.kind, "found");
  if (result.kind === "found") assert.equal(result.product.name, "홍옥 사과 백업본");

  const restoredPrimary = JSON.parse(await readFile(path, "utf8")) as Array<{ name: string }>;
  assert.equal(restoredPrimary.find((item) => item.name === "홍옥 사과 백업본")?.name, "홍옥 사과 백업본");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("catalog fails closed when both primary and backup are corrupted", async () => {
  const { catalog, path } = await makeCatalog();
  await catalog.upsert("tenant-a", {
    masterSku: "APPLE-A",
    name: "홍옥 사과 백업 준비",
    aliases: [],
    markets: { naver: { externalId: "A2" } }
  });
  await writeFile(path, "{broken-primary", "utf8");
  await writeFile(`${path}.bak`, "{broken-backup", "utf8");

  await assert.rejects(() => ProductCatalog.load(path));
});

test("failed catalog persistence does not publish phantom state and later writes recover", async () => {
  const { catalog, path } = await makeCatalog();
  await rm(path);
  await mkdir(path);

  await assert.rejects(() => catalog.upsert("tenant-a", {
    masterSku: "APPLE-A",
    name: "저장되면 안 되는 상태",
    aliases: ["phantom"],
    markets: { naver: { externalId: "BROKEN" } }
  }));

  const afterFailure = catalog.resolve("APPLE-A", "tenant-a");
  assert.equal(afterFailure.kind, "found");
  if (afterFailure.kind === "found") {
    assert.equal(afterFailure.product.name, "홍옥 사과 5kg");
    assert.equal(afterFailure.product.markets.naver?.externalId, "A1");
  }

  await rm(path, { recursive: true });
  await catalog.upsert("tenant-a", {
    masterSku: "APPLE-A",
    name: "복구 후 정상 저장",
    aliases: ["recovered"],
    markets: { naver: { externalId: "A9" } }
  });

  const reloaded = await ProductCatalog.load(path);
  const recovered = reloaded.resolve("APPLE-A", "tenant-a");
  assert.equal(recovered.kind, "found");
  if (recovered.kind === "found") {
    assert.equal(recovered.product.name, "복구 후 정상 저장");
    assert.equal(recovered.product.markets.naver?.externalId, "A9");
  }
});

test("concurrent marketplace mapping writes preserve both updates", async () => {
  const { catalog, path } = await makeCatalog();

  await Promise.all([
    catalog.setMarketplaceMapping("tenant-a", "APPLE-A", "coupang", { externalId: "10001", productId: "20001" }),
    catalog.setMarketplaceMapping("tenant-a", "APPLE-A", "toss", { externalId: "TOSS-1", productId: "TOSS-P-1" })
  ]);

  const reloaded = await ProductCatalog.load(path);
  const result = reloaded.resolve("APPLE-A", "tenant-a");
  assert.equal(result.kind, "found");
  if (result.kind === "found") {
    assert.equal(result.product.markets.naver?.externalId, "A1");
    assert.equal(result.product.markets.coupang?.externalId, "10001");
    assert.equal(result.product.markets.coupang?.productId, "20001");
    assert.equal(result.product.markets.toss?.externalId, "TOSS-1");
    assert.equal(result.product.markets.toss?.productId, "TOSS-P-1");
  }
});
