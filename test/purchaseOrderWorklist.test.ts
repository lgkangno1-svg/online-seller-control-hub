import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseOrderWorklist } from "../src/orders/purchaseOrderWorklist.js";

test("suggests replenishment and prioritizes lead-time stockout risk", () => {
  const result = buildPurchaseOrderWorklist([
    { sku: "SAFE", availableStock: 30, reorderPoint: 10, targetStock: 50 },
    { sku: "LOW", availableStock: 8, reservedStock: 3, reorderPoint: 10, targetStock: 30, dailySales: 2, supplierLeadDays: 4 },
    { sku: "OPEN", availableStock: 3, reorderPoint: 10, targetStock: 20, openPurchaseQty: 12 },
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(
    {
      sku: result[0]?.sku,
      netAvailable: result[0]?.netAvailable,
      suggestedQty: result[0]?.suggestedQty,
      urgency: result[0]?.urgency,
    },
    { sku: "LOW", netAvailable: 5, suggestedQty: 25, urgency: "critical" },
  );
});
