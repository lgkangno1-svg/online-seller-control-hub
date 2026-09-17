import type { UnifiedOrderLine } from "./orderInbox.js";

const HEADERS = ["market","externalOrderId","externalOrderLineId","masterSku","productName","quantity","unitPrice","status","orderedAt"] as const;
const esc = (v: unknown) => { const s=String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };

/** Spreadsheet-safe unified order export. Buyer/receiver PII is deliberately excluded. */
export function exportOrdersCsv(orders: readonly UnifiedOrderLine[]): string {
  if (orders.length > 50_000) throw new Error("maximum 50000 order lines per export");
  const rows = orders.map(o => [o.market,o.externalOrderId,o.externalOrderLineId,o.masterSku ?? "",o.productName,o.quantity,o.unitPrice,o.status,o.orderedAt]);
  return [HEADERS, ...rows].map(row => row.map(esc).join(",")).join("\n") + "\n";
}
