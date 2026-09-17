import { z } from "zod";

const rowSchema = z.object({ masterSku: z.string().trim().min(1).max(120), onHand: z.number().int().nonnegative(), safetyStock: z.number().int().nonnegative().default(0), reservations: z.array(z.object({ reference: z.string().trim().min(1).max(160), quantity: z.number().int().positive() })).max(5000) });

export function calculateInventoryReservations(input: unknown) {
  const rows = z.array(rowSchema).max(10000).parse(input);
  return rows.map((row) => {
    const reserved = row.reservations.reduce((sum, item) => sum + item.quantity, 0);
    const sellable = Math.max(0, row.onHand - row.safetyStock - reserved);
    return { masterSku: row.masterSku, onHand: row.onHand, safetyStock: row.safetyStock, reserved, sellable, oversold: reserved > Math.max(0, row.onHand - row.safetyStock) };
  });
}

export function summarizeInventoryReservations(input: unknown) {
  const rows = calculateInventoryReservations(input);
  return { skuCount: rows.length, reservedUnits: rows.reduce((s, r) => s + r.reserved, 0), sellableUnits: rows.reduce((s, r) => s + r.sellable, 0), oversoldSkus: rows.filter((r) => r.oversold).map((r) => r.masterSku) };
}
