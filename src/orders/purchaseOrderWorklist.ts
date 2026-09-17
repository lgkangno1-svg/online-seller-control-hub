export type PurchaseOrderCandidate = {
  sku: string;
  availableStock: number;
  reservedStock?: number;
  reorderPoint: number;
  targetStock: number;
  openPurchaseQty?: number;
  supplierLeadDays?: number;
  dailySales?: number;
};

export type PurchaseOrderSuggestion = {
  sku: string;
  netAvailable: number;
  suggestedQty: number;
  urgency: 'critical' | 'high' | 'normal';
  reason: string;
};

export function buildPurchaseOrderWorklist(items: PurchaseOrderCandidate[]): PurchaseOrderSuggestion[] {
  return items.flatMap((item) => {
    const netAvailable = Math.max(0, item.availableStock - (item.reservedStock ?? 0));
    const projected = netAvailable + (item.openPurchaseQty ?? 0);
    if (projected > item.reorderPoint) return [];

    const suggestedQty = Math.max(0, item.targetStock - projected);
    if (suggestedQty === 0) return [];

    const leadDemand = (item.dailySales ?? 0) * (item.supplierLeadDays ?? 0);
    const urgency: PurchaseOrderSuggestion['urgency'] =
      netAvailable <= leadDemand ? 'critical' : projected <= Math.floor(item.reorderPoint / 2) ? 'high' : 'normal';

    return [{
      sku: item.sku,
      netAvailable,
      suggestedQty,
      urgency,
      reason: `projected ${projected} <= reorder point ${item.reorderPoint}`,
    }];
  }).sort((a, b) => {
    const rank = { critical: 0, high: 1, normal: 2 } as const;
    return rank[a.urgency] - rank[b.urgency] || b.suggestedQty - a.suggestedQty;
  });
}
