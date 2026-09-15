import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const resultSchema = z.object({
  market: z.enum(MARKETS),
  ok: z.boolean(),
  message: z.string(),
  externalId: z.string().nullable(),
  controlExternalId: z.string().nullable().optional()
});

const recordSchema = z.object({
  tenantId: z.string().min(1),
  market: z.enum(MARKETS),
  idempotencyKey: z.string().min(8).max(200),
  payloadHash: z.string().length(64),
  masterSku: z.string().min(1).max(120),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  result: resultSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const fileSchema = z.array(recordSchema);
type RecordRow = z.infer<typeof recordSchema>;
export type CachedRegistrationResult = z.infer<typeof resultSchema>;

export type RegistrationClaim =
  | { kind: "claimed"; payloadHash: string }
  | { kind: "cached"; result: CachedRegistrationResult }
  | { kind: "conflict"; reason: string };

export type RegistrationRecoveryCandidate = {
  tenantId: string;
  market: Market;
  idempotencyKey: string;
  masterSku: string;
  createdAt: string;
  updatedAt: string;
};

export type RegistrationRecoveryMapping = {
  externalId: string;
  controlExternalId?: string | null;
};

export class RegistrationLedger {
  private rows: RecordRow[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string) {}

  static async load(path: string): Promise<RegistrationLedger> {
    const ledger = new RegistrationLedger(path);
    try {
      ledger.rows = await readRows(path);
    } catch (primaryError) {
      const primaryCode = errorCode(primaryError);
      try {
        ledger.rows = await readRows(backupPath(path));
        await writeSnapshot(path, ledger.rows);
      } catch (backupError) {
        if (primaryCode !== "ENOENT" || errorCode(backupError) !== "ENOENT") throw primaryError;
      }
    }
    return ledger;
  }

  async claim(input: {
    tenantId: string;
    market: Market;
    idempotencyKey: string;
    masterSku: string;
    payload: unknown;
  }): Promise<RegistrationClaim> {
    const payloadHash = hashPayload(input.payload);
    return this.enqueueMutation((rows) => {
      const existing = rows.find((row) =>
        row.tenantId === input.tenantId && row.market === input.market && row.idempotencyKey === input.idempotencyKey
      );

      if (existing) {
        if (existing.payloadHash !== payloadHash || existing.masterSku !== input.masterSku) {
          return {
            rows,
            result: { kind: "conflict", reason: "같은 중복방지 키로 다른 상품 또는 다른 요청을 보낼 수 없습니다." } as RegistrationClaim,
            persist: false
          };
        }
        if (existing.status === "COMPLETED" && existing.result) {
          return { rows, result: { kind: "cached", result: existing.result } as RegistrationClaim, persist: false };
        }
        if (existing.status === "PENDING") {
          return {
            rows,
            result: { kind: "conflict", reason: "동일한 상품 등록 요청이 이미 처리 중이거나 결과 확인이 필요합니다." } as RegistrationClaim,
            persist: false
          };
        }
      }

      const now = new Date().toISOString();
      const row: RecordRow = {
        tenantId: input.tenantId,
        market: input.market,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        masterSku: input.masterSku,
        status: "PENDING",
        result: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      return {
        rows: [
          ...rows.filter((item) => !(item.tenantId === input.tenantId && item.market === input.market && item.idempotencyKey === input.idempotencyKey)),
          row
        ],
        result: { kind: "claimed", payloadHash } as RegistrationClaim
      };
    });
  }

  async finish(input: {
    tenantId: string;
    market: Market;
    idempotencyKey: string;
    result: CachedRegistrationResult;
  }): Promise<void> {
    await this.enqueueMutation((rows) => {
      const index = rows.findIndex((row) =>
        row.tenantId === input.tenantId && row.market === input.market && row.idempotencyKey === input.idempotencyKey
      );
      if (index < 0) throw new Error("registration claim not found");
      const current = rows[index]!;
      return {
        rows: rows.map((row, itemIndex) => itemIndex === index ? {
          ...current,
          status: input.result.ok ? "COMPLETED" as const : "FAILED" as const,
          result: input.result,
          updatedAt: new Date().toISOString()
        } : row),
        result: undefined
      };
    });
  }

  async reconcileMapped(
    resolveMapping: (candidate: RegistrationRecoveryCandidate) => RegistrationRecoveryMapping | null
  ): Promise<number> {
    return this.enqueueMutation((rows) => {
      let recovered = 0;
      const now = new Date().toISOString();
      const next = rows.map((row) => {
        if (row.status !== "PENDING") return row;
        const mapping = resolveMapping({
          tenantId: row.tenantId,
          market: row.market,
          idempotencyKey: row.idempotencyKey,
          masterSku: row.masterSku,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        });
        if (!mapping?.externalId?.trim()) return row;
        recovered += 1;
        return {
          ...row,
          status: "COMPLETED" as const,
          result: {
            market: row.market,
            ok: true,
            message: "서버 재시작 후 저장된 상품 매핑에서 등록 결과를 복구했습니다.",
            externalId: mapping.externalId.trim(),
            ...(mapping.controlExternalId?.trim() ? { controlExternalId: mapping.controlExternalId.trim() } : {})
          },
          updatedAt: now
        };
      });
      return { rows: next, result: recovered, persist: recovered > 0 };
    });
  }

  private async enqueueMutation<T>(mutate: (rows: RecordRow[]) => {
    rows: RecordRow[];
    result: T;
    persist?: boolean;
  }): Promise<T> {
    const operation = this.writeQueue.then(async () => {
      const mutation = mutate(this.rows);
      if (mutation.persist === false) return mutation.result;
      await this.persistRows(mutation.rows);
      // Publish state only after the corresponding snapshot is durable.
      this.rows = mutation.rows;
      return mutation.result;
    });

    // Reject the failing caller without poisoning every later mutation.
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persistRows(rows: RecordRow[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const current = await readFile(this.path, "utf8");
      fileSchema.parse(JSON.parse(current));
      await writeRawFile(backupPath(this.path), current, "backup");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        // Preserve the previous known-good backup if the live file is malformed.
      }
    }
    await writeSnapshot(this.path, rows);
  }
}

async function readRows(path: string): Promise<RecordRow[]> {
  return fileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function writeSnapshot(path: string, rows: RecordRow[]): Promise<void> {
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

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
