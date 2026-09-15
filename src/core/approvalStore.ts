import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { CatalogProduct } from "../catalog/catalog.js";
import { commandSchema, MARKETS, type MarketState, type ParsedCommand } from "./types.js";

export type ApprovalActor = {
  kind: "telegram" | "web";
  id: string;
};

export type PendingApproval = {
  id: string;
  createdAt: number;
  expiresAt: number;
  actor: ApprovalActor;
  command: ParsedCommand;
  product: CatalogProduct;
  snapshot: MarketState[];
};

const actorSchema = z.object({
  kind: z.enum(["telegram", "web"]),
  id: z.string().min(1).max(300)
});
const marketMappingSchema = z.object({
  externalId: z.string().min(1).max(300).optional(),
  productId: z.string().min(1).max(300).optional()
});
const productSchema = z.object({
  tenantId: z.string().min(1).max(100),
  masterSku: z.string().min(1).max(120),
  name: z.string().min(1).max(300),
  aliases: z.array(z.string().min(1).max(300)).max(30),
  markets: z.object({
    naver: marketMappingSchema.optional(),
    coupang: marketMappingSchema.optional(),
    gmarket: marketMappingSchema.optional(),
    lotteon: marketMappingSchema.optional(),
    toss: marketMappingSchema.optional(),
    kakao: marketMappingSchema.optional()
  })
});
const marketStateSchema = z.object({
  market: z.enum(MARKETS),
  externalId: z.string(),
  price: z.number().nullable(),
  stock: z.number().nullable(),
  saleStatus: z.enum(["ON_SALE", "STOPPED", "OUT_OF_STOCK", "UNKNOWN"])
});
const pendingApprovalSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  actor: actorSchema,
  command: commandSchema,
  product: productSchema,
  snapshot: z.array(marketStateSchema)
});
const persistedApprovalsSchema = z.array(pendingApprovalSchema);

export class ApprovalStore {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly ttlMs: number,
    private readonly persistencePath: string | null = null
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Approval TTL must be positive");
    this.loadPersisted();
  }

  create(input: Omit<PendingApproval, "id" | "createdAt" | "expiresAt">): PendingApproval {
    const now = Date.now();
    const approval: PendingApproval = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      expiresAt: now + this.ttlMs
    };
    const next = new Map(this.pending);
    next.set(approval.id, approval);
    this.persist(next.values());
    this.pending.set(approval.id, approval);
    return approval;
  }

  consume(id: string, actor: ApprovalActor): PendingApproval | null {
    const approval = this.pending.get(id);
    if (!approval) return null;
    if (approval.expiresAt < Date.now()) {
      this.removePersistedFirst(id);
      return null;
    }
    if (!sameActor(approval.actor, actor)) return null;
    this.removePersistedFirst(id);
    return approval;
  }

  cancel(id: string, actor: ApprovalActor): boolean {
    const approval = this.pending.get(id);
    if (!approval) return false;
    if (approval.expiresAt < Date.now()) {
      this.removePersistedFirst(id);
      return false;
    }
    if (!sameActor(approval.actor, actor)) return false;
    this.removePersistedFirst(id);
    return true;
  }

  private removePersistedFirst(id: string): void {
    const next = new Map(this.pending);
    next.delete(id);
    this.persist(next.values());
    this.pending.delete(id);
  }

  private loadPersisted(): void {
    if (!this.persistencePath || !existsSync(this.persistencePath)) return;
    try {
      const parsed = persistedApprovalsSchema.parse(JSON.parse(readFileSync(this.persistencePath, "utf8")));
      const now = Date.now();
      const live = parsed.filter((approval) => approval.expiresAt > now) as PendingApproval[];
      if (live.length !== parsed.length) this.persist(live);
      for (const approval of live) this.pending.set(approval.id, approval);
    } catch (error) {
      throw new Error(`Approval persistence file is invalid: ${this.persistencePath}`, { cause: error });
    }
  }

  private persist(approvals: Iterable<PendingApproval> = this.pending.values()): void {
    if (!this.persistencePath) return;
    mkdirSync(dirname(this.persistencePath), { recursive: true });
    const tempPath = `${this.persistencePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(tempPath, JSON.stringify([...approvals], null, 2), { encoding: "utf8", mode: 0o600 });
      renameSync(tempPath, this.persistencePath);
    } catch (error) {
      throw new Error(`Failed to persist approvals: ${this.persistencePath}`, { cause: error });
    } finally {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // Best effort only: never mask the persistence error with temp-file cleanup failure.
      }
    }
  }
}

function sameActor(left: ApprovalActor, right: ApprovalActor): boolean {
  return left.kind === right.kind && left.id === right.id;
}
