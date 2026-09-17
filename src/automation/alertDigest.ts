import { z } from "zod";
import { MARKETS } from "../core/types.js";

const alertSchema = z.object({ market: z.enum(MARKETS).optional(), type: z.enum(["auth", "sync_failure", "stock_risk", "claim_sla", "settlement_mismatch", "order_backlog"]), message: z.string().trim().min(1).max(500), count: z.number().int().positive().default(1) });
const rank = { critical: 0, warning: 1, info: 2 } as const;

export function buildAlertDigest(input: unknown) {
  const alerts = z.array(alertSchema).max(2000).parse(input);
  return alerts.map((alert) => {
    const severity: keyof typeof rank = alert.type === "auth" || alert.type === "sync_failure" ? "critical" : alert.type === "stock_risk" || alert.type === "claim_sla" || alert.type === "settlement_mismatch" ? "warning" : "info";
    return { ...alert, severity, requiresConfirmation: false as const };
  }).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function summarizeAlertDigest(input: unknown) {
  const rows = buildAlertDigest(input);
  return { total: rows.reduce((n, r) => n + r.count, 0), critical: rows.filter((r) => r.severity === "critical").reduce((n, r) => n + r.count, 0), warning: rows.filter((r) => r.severity === "warning").reduce((n, r) => n + r.count, 0) };
}
