import assert from "node:assert/strict";
import test from "node:test";
import { groupOrdersByMarket, normalizeOrderInbox, summarizeOrderInbox } from "../src/orders/orderInbox.js";

const orders = [
  { market: "naver", externalOrderId: "n-order-1", externalOrderLineId: "n-line-1", masterSku: "APPLE-5KG", productName: "Apple 5kg", quantity: 2, unitPrice: 30000, status: "new", orderedAt: "2026-09-16T08:00:00+09:00", buyerName: "Buyer A" },
  { market: "coupang", externalOrderId: "c-order-1", externalOrderLineId: "c-line-1", productName: "Pear 5kg", quantity: 1, unitPrice: 40000, status: "preparing", orderedAt: "2026-09-16T10:00:00+09:00" },
  { market: "naver", externalOrderId: "n-order-2", externalOrderLineId: "n-line-2", masterSku: "MANGO-36", productName: "Mango 3.6kg", quantity: 3, unitPrice: 25000, status: "shipped", orderedAt: "2026-09-16T09:00:00+09:00" }
] as const;

test("normalizes marketplace orders into newest-first unified inbox", () => {
  assert.deepEqual(normalizeOrderInbox(orders).map((order) => order.externalOrderLineId), ["c-line-1", "n-line-2", "n-line-1"]);
});

test("groups normalized orders by marketplace", () => {
  const groups = groupOrdersByMarket(orders);
  assert.deepEqual(groups.map((group) => [group.market, group.items.length]), [["coupang", 1], ["naver", 2]]);
});

test("summarizes processing workload and unmapped SKUs without marketplace writes", () => {
  assert.deepEqual(summarizeOrderInbox(orders), {
    totalLines: 3,
    totalUnits: 6,
    grossAmount: 175000,
    needsProcessing: 2,
    unmappedSku: 1,
    byStatus: { new: 1, confirmed: 0, preparing: 1, shipped: 1, delivered: 0, cancelled: 0 }
  });
});

test("rejects duplicate marketplace order line ids", () => {
  assert.throws(() => normalizeOrderInbox([orders[0], { ...orders[0], externalOrderId: "other" }]), /duplicate marketplace order line/);
});

test("rejects invalid quantities and unknown states", () => {
  assert.throws(() => normalizeOrderInbox([{ ...orders[0], quantity: 0 }]));
  assert.throws(() => normalizeOrderInbox([{ ...orders[0], status: "mystery" }]));
});
