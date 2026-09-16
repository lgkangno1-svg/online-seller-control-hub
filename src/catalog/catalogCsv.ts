import { z } from "zod";
import type { WritableCatalogProduct } from "./catalog.js";

const MAX_ROWS = 1000;
const headers = ["masterSku", "name", "aliases", "naver", "coupang", "gmarket", "lotteon", "toss", "kakao"] as const;
const marketHeaders = headers.slice(3);

export type CatalogCsvImport = { products: WritableCatalogProduct[]; errors: Array<{ row: number; message: string }> };

export function importCatalogCsv(csv: string): CatalogCsvImport {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { products: [], errors: [{ row: 1, message: "CSV is empty" }] };
  const actual = rows[0]!.map((value) => value.trim());
  if (actual.join("\u0000") !== headers.join("\u0000")) return { products: [], errors: [{ row: 1, message: `expected headers: ${headers.join(",")}` }] };
  if (rows.length - 1 > MAX_ROWS) return { products: [], errors: [{ row: 1, message: `maximum ${MAX_ROWS} products per import` }] };

  const products: WritableCatalogProduct[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((value) => value.trim() === "")) return;
    if (row.length !== headers.length) { errors.push({ row: rowNumber, message: `expected ${headers.length} columns` }); return; }
    const masterSku = row[0]!.trim();
    const key = masterSku.toLowerCase();
    if (seen.has(key)) { errors.push({ row: rowNumber, message: "duplicate masterSku" }); return; }
    seen.add(key);
    try {
      const markets: WritableCatalogProduct["markets"] = {};
      marketHeaders.forEach((market, offset) => {
        const externalId = row[offset + 3]!.trim();
        if (externalId) markets[market] = { externalId };
      });
      products.push({ masterSku, name: row[1]!.trim(), aliases: row[2]!.split("|").map((v) => v.trim()).filter(Boolean), markets });
    } catch (error) { errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "invalid row" }); }
  });
  return { products, errors };
}

export function exportCatalogCsv(products: ReadonlyArray<{ masterSku: string; name: string; aliases: string[]; markets: Record<string, { externalId?: string; productId?: string } | undefined> }>): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const product of products) {
    const values = [product.masterSku, product.name, product.aliases.join("|"), ...marketHeaders.map((market) => product.markets[market]?.externalId ?? product.markets[market]?.productId ?? "")];
    lines.push(values.map(escapeCsv).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function escapeCsv(value: string): string { return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; }

function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false; else field += ch; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (quoted) throw new z.ZodError([{ code: "custom", path: [], message: "unterminated quoted CSV field" }]);
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
