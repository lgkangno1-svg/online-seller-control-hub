import { z } from "zod";
import { MARKETS } from "../core/types.js";

const syncSchema = z.object({ market: z.enum(MARKETS), domain: z.enum(["products", "inventory", "orders", "claims", "settlement"]), lastSuccessAt: z.string().datetime({ offset: true }).optional(), pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), authHealthy: z.boolean() });

export function buildMarketSyncDashboard(input: unknown, now = new Date()) {
  const rows = z.array(syncSchema).max(1000).parse(input);
  return rows.map((row) => {
    const ageMinutes = row.lastSuccessAt ? Math.floor((now.getTime() - Date.parse(row.lastSuccessAt)) / 60000) : null;
    const severity = !row.authHealthy || row.failed > 0 ? "critical" : ageMinutes === null || ageMinutes > 60 || row.pending > 100 ? "warning" : "healthy";
    return { ...row, ageMinutes, severity };
  }).sort((a, b) => ({ critical: 0, warning: 1, healthy: 2 }[a.severity] - ({ critical: 0, warning: 1, healthy: 2 }[b.severity]));
}

export function summarizeMarketSyncDashboard(input: unknown, now = new Date()) {
  const rows = buildMarketSyncDashboard(input, now);
  return { total: rows.length, critical: rows.filter((r) => r.severity === "critical").length, warning: rows.filter((r) => r.severity === "warning").length, pending: rows.reduce((s, r) => s + r.pending, 0), failed: rows.reduce((s, r) => s + r.failed, 0) };
}
