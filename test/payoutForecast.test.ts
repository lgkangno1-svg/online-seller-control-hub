import { describe, expect, it } from 'vitest';
import { buildPayoutForecast } from '../src/settlement/payoutForecast.js';

describe('buildPayoutForecast', () => {
  it('groups expected cash inflows by payout date', () => {
    const result = buildPayoutForecast([
      { market: 'naver', expectedPayoutDate: '2026-09-20T01:00:00Z', grossAmount: 100000, fees: 3000 },
      { market: 'coupang', expectedPayoutDate: '2026-09-20T09:00:00Z', grossAmount: 50000, refunds: 10000 },
      { market: 'gmarket', expectedPayoutDate: '2026-09-21T00:00:00Z', grossAmount: 20000 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: '2026-09-20', gross: 150000, deductions: 13000, net: 137000 });
    expect(result[0].markets.sort()).toEqual(['coupang', 'naver']);
  });
});
