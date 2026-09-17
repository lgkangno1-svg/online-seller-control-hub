export type AgingOrder = {
  orderId: string;
  market: string;
  status: string;
  statusSince: Date | string;
  promisedShipAt?: Date | string;
};

export type AgingOrderRow = AgingOrder & {
  ageHours: number;
  overdue: boolean;
  priority: 'critical' | 'high' | 'normal';
};

export function buildOrderAgingWorklist(orders: AgingOrder[], now = new Date()): AgingOrderRow[] {
  const terminal = new Set(['delivered', 'cancelled', 'returned', 'refunded']);
  return orders.filter((order) => !terminal.has(order.status.toLowerCase())).map((order) => {
    const since = new Date(order.statusSince);
    const ageHours = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 3_600_000));
    const promised = order.promisedShipAt ? new Date(order.promisedShipAt) : undefined;
    const overdue = Boolean(promised && promised.getTime() < now.getTime());
    const priority: AgingOrderRow['priority'] = overdue ? 'critical' : ageHours >= 24 ? 'high' : 'normal';
    return { ...order, ageHours, overdue, priority };
  }).sort((a, b) => {
    const rank = { critical: 0, high: 1, normal: 2 } as const;
    return rank[a.priority] - rank[b.priority] || b.ageHours - a.ageHours;
  });
}
