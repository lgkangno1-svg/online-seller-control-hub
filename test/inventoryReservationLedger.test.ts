import assert from "node:assert/strict";
import test from "node:test";
import { calculateInventoryReservations, summarizeInventoryReservations } from "../src/operations/inventoryReservationLedger.js";

test("reserves stock before exposing sellable inventory", () => {
  const input = [{ masterSku: "A", onHand: 10, safetyStock: 2, reservations: [{ reference: "order-1", quantity: 3 }] }, { masterSku: "B", onHand: 2, safetyStock: 1, reservations: [{ reference: "order-2", quantity: 2 }] }];
  const rows = calculateInventoryReservations(input);
  assert.equal(rows[0]?.sellable, 5);
  assert.equal(rows[1]?.oversold, true);
  assert.deepEqual(summarizeInventoryReservations(input).oversoldSkus, ["B"]);
});
