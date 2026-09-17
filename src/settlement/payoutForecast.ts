export type PendingSettlement = {
  market: string;
  expectedPayoutDate: Date | string;
  grossAmount: number;
  fees?: number;
  refunds?: number;
};

export type PayoutForecastBucket = {
  date: string;
  gross: number;
  deductions: number;
  net: number;
  markets: string[];
};

export function buildPayoutForecast(rows: PendingSettlement[]): PayoutForecastBucket[] {
  const buckets = new Map<string, PayoutForecastBucket>();
  for (const row of rows) {
    const date = new Date(row.expectedPayoutDate).toISOString().slice(0, 10);
    const gross = Math.max(0, row.grossAmount);
    const deductions = Math.max(0, row.fees ?? 0) + Math.max(0, row.refunds ?? 0);
    const existing = buckets.get(date) ?? { date, gross: 0, deductions: 0, net: 0, markets: [] };
    existing.gross += gross;
    existing.deductions += deductions;
    existing.net += gross - deductions;
    if (!existing.markets.includes(row.market)) existing.markets.push(row.market);
    buckets.set(date, existing);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}
