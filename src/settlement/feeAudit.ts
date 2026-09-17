export type SettlementFeeRow = {
  marketplace: string;
  orderId: string;
  grossAmount: number;
  expectedFee: number;
  actualFee: number;
};

export type SettlementFeeAnomaly = SettlementFeeRow & {
  delta: number;
  deltaRate: number;
  severity: "warning" | "critical";
};

export function auditSettlementFees(
  rows: SettlementFeeRow[],
  options: { toleranceAmount?: number; toleranceRate?: number } = {},
): SettlementFeeAnomaly[] {
  const toleranceAmount = options.toleranceAmount ?? 100;
  const toleranceRate = options.toleranceRate ?? 0.01;
  if (toleranceAmount < 0 || toleranceRate < 0) throw new Error("tolerances must be non-negative");

  return rows.flatMap((row) => {
    if (!row.marketplace || !row.orderId) throw new Error("marketplace and orderId are required");
    if (![row.grossAmount, row.expectedFee, row.actualFee].every(Number.isFinite)) throw new Error("amounts must be finite");
    const delta = row.actualFee - row.expectedFee;
    const denominator = Math.max(Math.abs(row.expectedFee), 1);
    const deltaRate = Math.abs(delta) / denominator;
    if (Math.abs(delta) <= toleranceAmount && deltaRate <= toleranceRate) return [];
    return [{ ...row, delta, deltaRate, severity: deltaRate >= Math.max(toleranceRate * 3, 0.05) ? "critical" as const : "warning" as const }];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
