import assert from "node:assert/strict";
import test from "node:test";
import { planOperationsAlerts, summarizeOperationsAlerts } from "../src/automation/operationsAlert.js";

const now = "2026-09-17T03:00:00+09:00";

test("plans only breached signals and ranks critical first", () => {
  const alerts = planOperationsAlerts([
    { kind: "order_backlog", market: "naver", count: 25, threshold: 20, label: "Naver orders waiting", detectedAt: now },
    { kind: "unmapped_sku", count: 3, threshold: 10, label: "SKU mapping", detectedAt: now },
    { kind: "claim_backlog", market: "coupang", count: 12, threshold: 5, label: "Claims waiting", detectedAt: now }
  ]);
  assert.equal(alerts.length, 2);
  assert.deepEqual(
    { kind: alerts[0]?.kind, severity: alerts[0]?.severity, requiresConfirmation: alerts[0]?.requiresConfirmation },
    { kind: "claim_backlog", severity: "critical", requiresConfirmation: true }
  );
  assert.deepEqual(
    { kind: alerts[1]?.kind, severity: alerts[1]?.severity, requiresConfirmation: alerts[1]?.requiresConfirmation },
    { kind: "order_backlog", severity: "warning", requiresConfirmation: false }
  );
});

test("summarizes alert workload without executing actions", () => {
  assert.deepEqual(summarizeOperationsAlerts([
    { kind: "stock_risk", market: "gmarket", count: 4, threshold: 2, label: "Low stock", detectedAt: now },
    { kind: "settlement_gap", count: 1, threshold: 1, label: "Settlement mismatch", detectedAt: now }
  ]), { total: 2, critical: 1, warning: 1, confirmationRequired: 1 });
});
