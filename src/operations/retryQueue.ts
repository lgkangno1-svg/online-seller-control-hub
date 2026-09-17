import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

export const OPERATION_KINDS = [
  "order_fetch",
  "settlement_fetch",
  "product_write",
  "order_status_write",
  "shipment_write",
  "claim_write"
] as const;

export const FAILURE_CLASSES = [
  "rate_limited",
  "transient",
  "auth",
  "validation",
  "ambiguous_write",
  "policy_blocked"
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export type RetryDisposition = "retry_ready" | "retry_wait" | "manual_review" | "exhausted";

const retryEntrySchema = z.object({
  operationId: z.string().trim().min(1).max(160),
  market: z.enum(MARKETS),
  kind: z.enum(OPERATION_KINDS),
  failureClass: z.enum(FAILURE_CLASSES),
  attempts: z.number().int().nonnegative().max(100),
  maxAttempts: z.number().int().positive().max(20).default(5),
  failedAt: z.string().datetime({ offset: true }),
  nextRetryAt: z.string().datetime({ offset: true }).optional(),
  message: z.string().trim().min(1).max(500).optional()
}).strict();

export type OperationRetryEntry = z.infer<typeof retryEntrySchema>;
export type OperationRetryPlanItem = OperationRetryEntry & {
  disposition: RetryDisposition;
  requiresConfirmation: boolean;
  automaticRetryAllowed: boolean;
};

const retryQueueSchema = z.array(retryEntrySchema).max(5000).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = `${item.market}:${item.operationId}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "operationId"], message: "duplicate marketplace operation failure" });
    }
    seen.add(key);
    if (item.attempts > item.maxAttempts) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "attempts"], message: "attempts cannot exceed maxAttempts" });
    }
  });
});

function isWrite(kind: OperationKind): boolean {
  return kind === "product_write" || kind === "order_status_write" || kind === "shipment_write" || kind === "claim_write";
}

function isManualFailure(failureClass: FailureClass): boolean {
  return failureClass === "auth" || failureClass === "validation" || failureClass === "ambiguous_write" || failureClass === "policy_blocked";
}

function dispositionFor(entry: OperationRetryEntry, nowMs: number): RetryDisposition {
  if (isManualFailure(entry.failureClass)) return "manual_review";
  if (entry.attempts >= entry.maxAttempts) return "exhausted";
  if (entry.nextRetryAt && Date.parse(entry.nextRetryAt) > nowMs) return "retry_wait";
  return "retry_ready";
}

/**
 * Read-only retry planner. Read operations may be automatically retried when a
 * transient/rate-limit failure is ready. Marketplace writes are never retried
 * automatically and require a fresh explicit confirmation before execution.
 * Ambiguous writes are always manual-review to avoid duplicate side effects.
 */
export function planOperationRetries(input: unknown, now = new Date()): OperationRetryPlanItem[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("invalid retry planner time");

  return retryQueueSchema.parse(input).map((entry) => {
    const disposition = dispositionFor(entry, nowMs);
    const write = isWrite(entry.kind);
    return {
      ...entry,
      disposition,
      requiresConfirmation: write || disposition === "manual_review",
      automaticRetryAllowed: !write && disposition === "retry_ready"
    };
  }).sort((a, b) => {
    const rank: Record<RetryDisposition, number> = { manual_review: 3, retry_ready: 2, retry_wait: 1, exhausted: 0 };
    return rank[b.disposition] - rank[a.disposition] || Date.parse(b.failedAt) - Date.parse(a.failedAt);
  });
}

export function summarizeOperationRetryQueue(input: unknown, now = new Date()) {
  const items = planOperationRetries(input, now);
  const byMarket = {} as Partial<Record<Market, number>>;
  for (const item of items) byMarket[item.market] = (byMarket[item.market] ?? 0) + 1;

  return {
    total: items.length,
    retryReady: items.filter((item) => item.disposition === "retry_ready").length,
    retryWaiting: items.filter((item) => item.disposition === "retry_wait").length,
    manualReview: items.filter((item) => item.disposition === "manual_review").length,
    exhausted: items.filter((item) => item.disposition === "exhausted").length,
    automaticRetryAllowed: items.filter((item) => item.automaticRetryAllowed).length,
    confirmationRequired: items.filter((item) => item.requiresConfirmation).length,
    byMarket
  };
}
