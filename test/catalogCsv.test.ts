import test from "node:test";
import assert from "node:assert/strict";
import { exportCatalogCsv, importCatalogCsv } from "../src/catalog/catalogCsv.js";

test("imports marketplace catalog CSV without performing external writes", () => {
  const csv = "masterSku,name,aliases,naver,coupang,gmarket,lotteon,toss,kakao\nSKU-1,Apple,red apple|fruit,N-1,C-1,,,,\n";
  const result = importCatalogCsv(csv);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.products[0], { masterSku: "SKU-1", name: "Apple", aliases: ["red apple", "fruit"], markets: { naver: { externalId: "N-1" }, coupang: { externalId: "C-1" } } });
});

test("round trips commas and quotes safely", () => {
  const csv = exportCatalogCsv([{ masterSku: "SKU-2", name: 'Gift, "Premium"', aliases: ["gift"], markets: { naver: { externalId: "N-2" } } }]);
  const result = importCatalogCsv(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.products[0]?.name, 'Gift, "Premium"');
});

test("reports duplicate SKU rows instead of silently overwriting", () => {
  const csv = "masterSku,name,aliases,naver,coupang,gmarket,lotteon,toss,kakao\nSKU-1,A,,,,,,,\nsku-1,B,,,,,,,\n";
  const result = importCatalogCsv(csv);
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.errors, [{ row: 3, message: "duplicate masterSku" }]);
});

test("rejects an unexpected template before importing anything", () => {
  const result = importCatalogCsv("sku,name\n1,A\n");
  assert.equal(result.products.length, 0);
  assert.match(result.errors[0]?.message ?? "", /expected headers/);
});
