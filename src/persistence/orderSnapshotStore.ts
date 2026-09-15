import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const MAX_ROWS_PER_TENANT = 5_000;

const orderInputSchema = z.object({
  market: z.enum(MARKETS),
  orderId: z.string().min(1).max(200),
  orderLineId: z.string().min(1).max(300),
  shipmentId: z.string().max(200).nullable(),
  listingId: z.string().max(200).nullable(),
  controlId: z.string().max(200).nullable(),
  productName: z.string().min(1).max(1000),
  optionName: z.string().max(1000).nullable(),
  quantity: z.number().finite().nullable(),
  price: z.number().finite().nullable(),
  status: z.string().min(1).max(120),
  orderedAt: z.string().max(100).nullable(),
  sellerSku: z.string().max(300).nullable()
}).strict();

const rowSchema = orderInputSchema.extend({
  tenantId: z.string().min(1).max(200),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime()
}).strict();
const fileSchema = z.array(rowSchema);

export type OrderSnapshotInput = z.infer<typeof orderInputSchema>;
export type OrderSnapshotRow = z.infer<typeof rowSchema>;
export type OrderSnapshotMergeResult = {
  inserted: number;
  updated: number;
  total: number;
};

export class OrderSnapshotStore {
  private rows: OrderSnapshotRow[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string) {}

  static async load(path: string): Promise<OrderSnapshotStore> {
    const store = new OrderSnapshotStore(path);
    try {
      store.rows = await readRows(path);
    } catch (primaryError) {
      const primaryCode = errorCode(primaryError);
      try {
        store.rows = await readRows(backupPath(path));
        await writeSnapshot(path, store.rows);
      } catch (backupError) {
        if (primaryCode !== "ENOENT" || errorCode(backupError) !== "ENOENT") throw primaryError;
      }
    }
    return store;
  }

  list(tenantId: string, options: { market?: Market; limit?: number } = {}): OrderSnapshotRow[] {
    const limit = Math.max(1, Math.min(options.limit ?? 500, MAX_ROWS_PER_TENANT));
    return this.rows
      .filter((row) => row.tenantId === tenantId && (!options.market || row.market === options.market))
      .sort((a, b) => orderTimestamp(b).localeCompare(orderTimestamp(a)))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  count(tenantId?: string): number {
    return tenantId ? this.rows.filter((row) => row.tenantId === tenantId).length : this.rows.length;
  }

  async merge(tenantId: string, items: OrderSnapshotInput[]): Promise<OrderSnapshotMergeResult> {
    const normalizedTenant = tenantId.trim();
    if (!normalizedTenant) throw new Error("tenantId is required");
    const validated = items.map((item) => orderInputSchema.parse(item));
    if (validated.length === 0) return { inserted: 0, updated: 0, total: this.count(normalizedTenant) };

    return this.enqueueMutation((rows) => {
      const now = new Date().toISOString();
      const next = new Map(rows.map((row) => [rowKey(row), row] as const));
      let inserted = 0;
      let updated = 0;

      for (const item of validated) {
        const key = rowKey({ tenantId: normalizedTenant, market: item.market, orderLineId: item.orderLineId });
        const existing = next.get(key);
        if (existing) updated += 1;
        else inserted += 1;
        next.set(key, {
          ...item,
          tenantId: normalizedTenant,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastSeenAt: now
        });
      }

      const pruned = prunePerTenant([...next.values()]);
      const total = pruned.filter((row) => row.tenantId === normalizedTenant).length;
      return { rows: pruned, result: { inserted, updated, total } };
    });
  }

  private async enqueueMutation<T>(mutate: (rows: OrderSnapshotRow[]) => { rows: OrderSnapshotRow[]; result: T }): Promise<T> {
    const operation = this.writeQueue.then(async () => {
      const mutation = mutate(this.rows);
      await this.persistRows(mutation.rows);
      this.rows = mutation.rows;
      return mutation.result;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persistRows(rows: OrderSnapshotRow[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const current = await readFile(this.path, "utf8");
      fileSchema.parse(JSON.parse(current));
      await writeRawFile(backupPath(this.path), current, "backup");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        // Keep the last known-good backup when the live snapshot is malformed.
      }
    }
    await writeSnapshot(this.path, rows);
  }
}

function rowKey(row: Pick<OrderSnapshotRow, "tenantId" | "market" | "orderLineId">): string {
  return `${row.tenantId}\u0000${row.market}\u0000${row.orderLineId}`;
}

function orderTimestamp(row: OrderSnapshotRow): string {
  return row.orderedAt || row.lastSeenAt;
}

function prunePerTenant(rows: OrderSnapshotRow[]): OrderSnapshotRow[] {
  const grouped = new Map<string, OrderSnapshotRow[]>();
  for (const row of rows) {
    const tenantRows = grouped.get(row.tenantId) ?? [];
    tenantRows.push(row);
    grouped.set(row.tenantId, tenantRows);
  }
  const kept: OrderSnapshotRow[] = [];
  for (const tenantRows of grouped.values()) {
    tenantRows.sort((a, b) => orderTimestamp(b).localeCompare(orderTimestamp(a)));
    kept.push(...tenantRows.slice(0, MAX_ROWS_PER_TENANT));
  }
  return kept;
}

async function readRows(path: string): Promise<OrderSnapshotRow[]> {
  return fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function writeSnapshot(path: string, rows: OrderSnapshotRow[]): Promise<void> {
  await writeRawFile(path, `${JSON.stringify(rows, null, 2)}\n`, "write");
}

async function writeRawFile(path: string, content: string, suffix: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.${suffix}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

function backupPath(path: string): string {
  return `${path}.bak`;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
}
