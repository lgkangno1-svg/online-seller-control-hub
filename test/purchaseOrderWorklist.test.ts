import { describe, expect, it } from 'vitest';
import { buildPurchaseOrderWorklist } from '../src/orders/purchaseOrderWorklist.js';

describe('buildPurchaseOrderWorklist', () => {
  it('suggests replenishment and prioritizes lead-time stockout risk', () => {
    const result = buildPurchaseOrderWorklist([
      { sku: 'SAFE', availableStock: 30, reorderPoint: 10, targetStock: 50 },
      { sku: 'LOW', availableStock: 8, reservedStock: 3, reorderPoint: 10, targetStock: 30, dailySales: 2, supplierLeadDays: 4 },
      { sku: 'OPEN', availableStock: 3, reorderPoint: 10, targetStock: 20, openPurchaseQty: 12 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sku: 'LOW', netAvailable: 5, suggestedQty: 25, urgency: 'critical' });
  });
});
