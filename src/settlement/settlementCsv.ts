import { z } from "zod";
import { MARKETS } from "../core/types.js";

const MAX_ROWS = 10_000;
export const SETTLEMENT_CSV_HEADERS = ["market", "settlementId", "orderId", "netAmount", "marketplaceFee", "settledAt"] as const;

const importedSettlementSchema = z.object({
  market: z.enum(MARKETS),
  settlementId: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(200),
  netAmount: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  marketplaceFee: z.number().finite().nonnegative().max(1_000_000_000),
  settledAt: z.string().datetime({ offset: true })
}).strict();

export type ImportedSettlement = z.infer<typeof importedSettlementSchema>;
export type SettlementCsvImport = {
  settlements: ImportedSettlement[];
  errors: Array<{ row: number; message: string }>;
};

/**
 * Imports a normalized SellerHub settlement CSV. Provider-specific exports can
 * be transformed into this stable shape before reconciliation. Invalid rows
 * are reported and never silently coerced into marketplace financial data.
 */
export function importSettlementCsv(csv: string): SettlementCsvImport {
  let rows: string[][];
  try {
    rows = parseCsv(csv);
  } catch (error) {
    return { settlements: [], errors: [{ row: 1, message: error instanceof Error ? error.message : "invalid CSV" }] };
  }

  if (rows.length === 0) return { settlements: [], errors: [{ row: 1, message: "CSV is empty" }] };
  const actualHeaders = rows[0]!.map((value) => value.trim());
  if (actualHeaders.join("\u0000") !== SETTLEMENT_CSV_HEADERS.join("\u0000")) {
    return { settlements: [], errors: [{ row: 1, message: `expected headers: ${SETTLEMENT_CSV_HEADERS.join(",")}` }] };
  }
  if (rows.length - 1 > MAX_ROWS) {
    return { settlements: [], errors: [{ row: 1, message: `maximum ${MAX_ROWS} settlements per import` }] };
  }

  const settlements: ImportedSettlement[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((value) => value.trim() === "")) return;
    if (row.length !== SETTLEMENT_CSV_HEADERS.length) {
      errors.push({ row: rowNumber, message: `expected ${SETTLEMENT_CSV_HEADERS.length} columns` });
      return;
    }

    const market = row[0]!.trim();
    const settlementId = row[1]!.trim();
    const orderId = row[2]!.trim();
    const netAmount = parseMoney(row[3]!);
    const marketplaceFee = parseMoney(row[4]!, 0);
    const settledAt = row[5]!.trim();
    const key = `${market}:${settlementId}`;

    if (seen.has(key)) {
      errors.push({ row: rowNumber, message: "duplicate marketplace settlement" });
      return;
    }

    const result = importedSettlementSchema.safeParse({ market, settlementId, orderId, netAmount, marketplaceFee, settledAt });
    if (!result.success) {
      errors.push({ row: rowNumber, message: result.error.issues.map((issue) => issue.message).join("; ") });
      return;
    }

    seen.add(key);
    settlements.push(result.data);
  });

  return { settlements, errors };
}

export function settlementCsvTemplate(): string {
  return `${SETTLEMENT_CSV_HEADERS.join(",")}\n`;
}

function parseMoney(value: string, emptyDefault?: number): number {
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "" && emptyDefault !== undefined) return emptyDefault;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  if (text.trim() === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (quoted) {
      if (ch === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  if (quoted) throw new Error("unterminated quoted CSV field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
