import { z } from "zod";
import { MARKETS } from "../core/types.js";

export const ALERT_KINDS = ["order_backlog", "unmapped_sku", "stock_risk", "claim_backlog", "settlement_gap"] as const;
export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;

const operationsSignalSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  market: z.enum(MARKETS).optional(),
  count: z.number().int().nonnegative().max(1_000_000),
  threshold: z.number().int().nonnegative().max(1_000_000),
  label: z.string().trim().min(1).max(200),
  detectedAt: z.string().datetime({ offset: true })
});

export type OperationsSignal = z.infer<typeof operationsSignalSchema>;
export type OperationsAlert = OperationsSignal & {
  id: string;
  severity: (typeof ALERT_SEVERITIES)[number];
  requiresConfirmation: boolean;
};

export const operationsSignalsSchema = z.array(operationsSignalSchema).max(5000);

function severityFor(signal: OperationsSignal): OperationsAlert["severity"] {
  if (signal.threshold === 0) return signal.count > 0 ? "critical" : "info";
  const ratio = signal.count / signal.threshold;
  if (ratio >= 2) return "critical";
  if (ratio >= 1) return "warning";
  return "info";
}

/** Read-only alert planner. It never performs marketplace writes. */
export function planOperationsAlerts(input: unknown): OperationsAlert[] {
  const signals = operationsSignalsSchema.parse(input);
  return signals
    .filter((signal) => signal.count >= signal.threshold && signal.count > 0)
    .map((signal) => ({
      ...signal,
      id: `${signal.kind}:${signal.market ?? "all"}:${signal.detectedAt}`,
      severity: severityFor(signal),
      requiresConfirmation: signal.kind === "stock_risk" || signal.kind === "claim_backlog"
    }))
    .sort((a, b) => {
      const rank = { critical: 2, warning: 1, info: 0 } as const;
      return rank[b.severity] - rank[a.severity] || Date.parse(b.detectedAt) - Date.parse(a.detectedAt);
    });
}

export function summarizeOperationsAlerts(input: unknown) {
  const alerts = planOperationsAlerts(input);
  return {
    total: alerts.length,
    critical: alerts.filter((alert) => alert.severity === "critical").length,
    warning: alerts.filter((alert) => alert.severity === "warning").length,
    confirmationRequired: alerts.filter((alert) => alert.requiresConfirmation).length,
    byKind: Object.fromEntries(ALERT_KINDS.map((kind) => [kind, alerts.filter((alert) => alert.kind === kind).length])) as Record<(typeof ALERT_KINDS)[number], number>
  };
}
