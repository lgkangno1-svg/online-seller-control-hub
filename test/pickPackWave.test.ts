import assert from "node:assert/strict";
import test from "node:test";
import { buildPickPackWave } from "../src/orders/pickPackWave.js";

test("consolidates pick quantities by master SKU across marketplaces", () => {
  const wave = buildPickPackWave([
    { market: "naver", externalOrderId: "n-1", externalOrderLineId: "nl-1", masterSku: "SKU-A", productName: "Apple", quantity: 2, status: "confirmed" },
    { market: "coupang", externalOrderId: "c-1", externalOrderLineId: "cl-1", masterSku: "SKU-A", productName: "Apple", quantity: 3, status: "preparing" },
    { market: "toss", externalOrderId: "t-1", externalOrderLineId: "tl-1", masterSku: "SKU-B", productName: "Pear", quantity: 1, status: "confirmed" }
  ]);

  assert.deepEqual(wave.pickList, [
    { masterSku: "SKU-A", productName: "Apple", totalUnits: 5, orderLineCount: 2, markets: { naver: 2, coupang: 3 } },
    { masterSku: "SKU-B", productName: "Pear", totalUnits: 1, orderLineCount: 1, markets: { toss: 1 } }
  ]);
  assert.deepEqual(wave.summary, {
    totalLines: 3,
    readyLines: 3,
    blockedUnmappedLines: 0,
    readyUnits: 6,
    uniqueSkus: 2
  });
});

test("blocks unmapped order lines instead of guessing a SKU", () => {
  const wave = buildPickPackWave([
    { market: "gmarket", externalOrderId: "g-1", externalOrderLineId: "gl-1", productName: "Unknown", quantity: 4, status: "confirmed" }
  ]);

  assert.equal(wave.readyLines.length, 0);
  assert.equal(wave.blockedUnmappedLines.length, 1);
  assert.equal(wave.pickList.length, 0);
  assert.equal(wave.summary.blockedUnmappedLines, 1);
});

test("rejects duplicate order lines and orders outside fulfillment states", () => {
  assert.throws(() => buildPickPackWave([
    { market: "naver", externalOrderId: "n-1", externalOrderLineId: "dup", masterSku: "SKU", productName: "Item", quantity: 1, status: "confirmed" },
    { market: "naver", externalOrderId: "n-1", externalOrderLineId: "dup", masterSku: "SKU", productName: "Item", quantity: 1, status: "preparing" }
  ]), /duplicate marketplace order line/);

  assert.throws(() => buildPickPackWave([
    { market: "naver", externalOrderId: "n-2", externalOrderLineId: "nl-2", masterSku: "SKU", productName: "Item", quantity: 1, status: "shipped" }
  ]));
});

test("bounds one wave to 1000 order lines", () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    market: "naver" as const,
    externalOrderId: `o-${index}`,
    externalOrderLineId: `l-${index}`,
    masterSku: `SKU-${index}`,
    productName: "Item",
    quantity: 1,
    status: "confirmed" as const
  }));
  assert.throws(() => buildPickPackWave(rows));
});
