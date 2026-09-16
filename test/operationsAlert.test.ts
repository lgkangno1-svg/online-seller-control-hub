import { describe, expect, it } from "vitest";
import { planOperationsAlerts, summarizeOperationsAlerts } from "../src/automation/operationsAlert.js";

describe("operations alerts", () => {
  const now = "2026-09-17T03:00:00+09:00";

  it("plans only breached signals and ranks critical first", () => {
    const alerts = planOperationsAlerts([
      { kind: "order_backlog", market: "naver", count: 25, threshold: 20, label: "Naver orders waiting", detectedAt: now },
      { kind: "unmapped_sku", count: 3, threshold: 10, label: "SKU mapping", detectedAt: now },
      { kind: "claim_backlog", market: "coupang", count: 12, threshold: 5, label: "Claims waiting", detectedAt: now }
    ]);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ kind: "claim_backlog", severity: "critical", requiresConfirmation: true });
    expect(alerts[1]).toMatchObject({ kind: "order_backlog", severity: "warning", requiresConfirmation: false });
  });

  it("summarizes alert workload without executing actions", () => {
    expect(summarizeOperationsAlerts([
      { kind: "stock_risk", market: "gmarket", count: 4, threshold: 2, label: "Low stock", detectedAt: now },
      { kind: "settlement_gap", count: 1, threshold: 1, label: "Settlement mismatch", detectedAt: now }
    ])).toMatchObject({ total: 2, critical: 1, warning: 1, confirmationRequired: 1 });
  });
});
