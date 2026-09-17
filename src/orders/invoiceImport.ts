import { z } from "zod";
import { MARKETS } from "../core/types.js";

const rowSchema = z.object({
  market: z.enum(MARKETS),
  externalOrderLineId: z.string().trim().min(1).max(120),
  carrierCode: z.string().trim().min(1).max(40),
  invoiceNumber: z.string().trim().min(5).max(80).regex(/^[A-Za-z0-9-]+$/),
});

export type InvoiceImportRow = z.infer<typeof rowSchema>;

export function planInvoiceImport(input: unknown) {
  const rows = z.array(rowSchema).min(1).max(2000).parse(input);
  const seenOrders = new Set<string>();
  const seenInvoices = new Set<string>();
  return rows.map((row) => {
    const orderKey = `${row.market}:${row.externalOrderLineId}`;
    if (seenOrders.has(orderKey)) throw new Error(`duplicate order line: ${orderKey}`);
    seenOrders.add(orderKey);
    const invoiceKey = `${row.carrierCode}:${row.invoiceNumber}`;
    if (seenInvoices.has(invoiceKey)) throw new Error(`duplicate invoice: ${invoiceKey}`);
    seenInvoices.add(invoiceKey);
    return { ...row, requiresConfirmation: true as const, operation: "register_invoice" as const };
  });
}

export function summarizeInvoiceImport(input: unknown) {
  const rows = planInvoiceImport(input);
  return {
    total: rows.length,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, rows.filter((row) => row.market === market).length])),
    confirmationRequired: rows.length,
  };
}
