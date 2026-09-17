import assert from "node:assert/strict";
import test from "node:test";
import { allocateSellableStock } from "../src/catalog/inventorySafetyAllocation.js";

test("keeps reserved and safety stock out of marketplace allocation", () => {
  const result = allocateSellableStock({ masterSku: "A", onHand: 100, reserved: 10, safetyStock: 10, markets: [{ market: "naver", weight: 3 }, { market: "coupang", weight: 1 }] });
  assert.equal(result.sellable, 80);
  assert.equal(result.blocked, 20);
  assert.deepEqual(result.allocations, [{ market: "naver", quantity: 60 }, { market: "coupang", quantity: 20 }]);
});

test("never exposes negative stock", () => {
  const result = allocateSellableStock({ masterSku: "A", onHand: 3, reserved: 5, safetyStock: 2, markets: [{ market: "naver", weight: 1 }] });
  assert.equal(result.sellable, 0);
  assert.equal(result.allocations[0]?.quantity, 0);
});

test("rejects duplicate market allocation", () => {
  assert.throws(() => allocateSellableStock({ masterSku: "A", onHand: 10, markets: [{ market: "naver", weight: 1 }, { market: "naver", weight: 1 }] }), /duplicate market allocation/);
});
