import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

export const ORDER_STATUSES = ["new", "confirmed", "preparing", "shipped", "delivered", "cancelled"] as const;

const orderLineSchema = z.object({
  market: z.enum(MARKETS),
  externalOrderId: z.string().trim().min(1).max(120),
  externalOrderLineId: z.string().trim().min(1).max(120),
  masterSku: z.string().trim().min(1).max(120).optional(),
  productName: z.string().trim().min(1).max(300),
  quantity: z.number().int().positive().max(100000),
  unitPrice: z.number().int().nonnegative().max(1_000_000_000),
  status: z.enum(ORDER_STATUSES),
  orderedAt: z.string().datetime({ offset: true }),
  buyerName: z.string().trim().min(1).max(120).optional()
});

export type UnifiedOrderLine = z.infer<typeof orderLineSchema>;
export type OrderMarketBatch = { market: Market; items: UnifiedOrderLine[] };

export const orderInboxSchema = z.array(orderLineSchema).max(5000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.externalOrderLineId}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "externalOrderLineId"], message: "duplicate marketplace order line" });
    }
    seen.add(key);
  });
});

/**
 * Read-only normalization layer for marketplace order feeds. It deliberately
 * performs no order acknowledgement, shipment, cancellation, or claim writes;
 * those remain separate approved workflows.
 */
export function normalizeOrderInbox(input: unknown): UnifiedOrderLine[] {
  return orderInboxSchema.parse(input).sort((a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt));
}

export function groupOrdersByMarket(input: unknown): OrderMarketBatch[] {
  const orders = normalizeOrderInbox(input);
  const grouped = new Map<Market, UnifiedOrderLine[]>();
  for (const order of orders) {
    const items = grouped.get(order.market);
    if (items) items.push(order);
    else grouped.set(order.market, [order]);
  }
  return [...grouped.entries()].map(([market, items]) => ({ market, items }));
}

export function summarizeOrderInbox(input: unknown) {
  const orders = normalizeOrderInbox(input);
  return {
    totalLines: orders.length,
    totalUnits: orders.reduce((sum, order) => sum + order.quantity, 0),
    grossAmount: orders.reduce((sum, order) => sum + order.quantity * order.unitPrice, 0),
    needsProcessing: orders.filter((order) => order.status === "new" || order.status === "confirmed" || order.status === "preparing").length,
    unmappedSku: orders.filter((order) => !order.masterSku).length,
    byStatus: Object.fromEntries(ORDER_STATUSES.map((status) => [status, orders.filter((order) => order.status === status).length])) as Record<(typeof ORDER_STATUSES)[number], number>
  };
}
