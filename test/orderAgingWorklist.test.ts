import { describe, expect, it } from 'vitest';
import { buildOrderAgingWorklist } from '../src/orders/orderAgingWorklist.js';

describe('buildOrderAgingWorklist', () => {
  it('prioritizes overdue and aging active orders', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    const rows = buildOrderAgingWorklist([
      { orderId: 'late', market: 'naver', status: 'paid', statusSince: '2026-09-17T20:00:00Z', promisedShipAt: '2026-09-17T23:00:00Z' },
      { orderId: 'old', market: 'coupang', status: 'paid', statusSince: '2026-09-16T20:00:00Z' },
      { orderId: 'done', market: 'naver', status: 'delivered', statusSince: '2026-09-10T00:00:00Z' },
    ], now);
    expect(rows.map((row) => row.orderId)).toEqual(['late', 'old']);
    expect(rows[0].priority).toBe('critical');
    expect(rows[1]).toMatchObject({ ageHours: 28, priority: 'high' });
  });
});
