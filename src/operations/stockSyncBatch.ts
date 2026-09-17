export type StockSyncTarget = { marketplace: string; sku: string; currentStock: number; targetStock: number };
export type StockSyncAction = StockSyncTarget & { delta: number; requiresConfirmation: boolean };

export function planStockSyncBatch(targets: StockSyncTarget[], maxItems = 1000): StockSyncAction[] {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 5000) throw new Error("maxItems must be between 1 and 5000");
  if (targets.length > maxItems) throw new Error(`stock sync batch exceeds ${maxItems} items`);
  const seen = new Set<string>();
  return targets.flatMap((target) => {
    if (!target.marketplace || !target.sku) throw new Error("marketplace and sku are required");
    if (![target.currentStock, target.targetStock].every((v) => Number.isInteger(v) && v >= 0)) throw new Error("stock must be non-negative integers");
    const key = `${target.marketplace}:${target.sku}`;
    if (seen.has(key)) throw new Error(`duplicate stock target: ${key}`);
    seen.add(key);
    if (target.currentStock === target.targetStock) return [];
    return [{ ...target, delta: target.targetStock - target.currentStock, requiresConfirmation: target.targetStock === 0 || Math.abs(target.targetStock - target.currentStock) >= 10 }];
  });
}
