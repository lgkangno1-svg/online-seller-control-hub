import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const expectedSettlementSchema = z.object({
  market: z.enum(MARKETS),
  orderId: z.string().trim().min(1).max(200),
  expectedNetAmount: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  expectedMarketplaceFee: z.number().finite().nonnegative().max(1_000_000_000).default(0)
}).strict();

const actualSettlementSchema = z.object({
  market: z.enum(MARKETS),
  settlementId: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(200),
  netAmount: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  marketplaceFee: z.number().finite().nonnegative().max(1_000_000_000).default(0),
  settledAt: z.string().datetime({ offset: true })
}).strict();

const reconciliationInputSchema = z.object({
  expected: z.array(expectedSettlementSchema).max(5000),
  actual: z.array(actualSettlementSchema).max(10000),
  tolerance: z.number().finite().nonnegative().max(10_000).default(1)
}).strict().superRefine((input, ctx) => {
  const expectedSeen = new Set<string>();
  input.expected.forEach((row, index) => {
    const key = `${row.market}:${row.orderId}`;
    if (expectedSeen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expected", index, "orderId"], message: "duplicate expected marketplace order" });
    }
    expectedSeen.add(key);
  });

  const actualSeen = new Set<string>();
  input.actual.forEach((row, index) => {
    const key = `${row.market}:${row.settlementId}`;
    if (actualSeen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actual", index, "settlementId"], message: "duplicate marketplace settlement" });
    }
    actualSeen.add(key);
  });
});

export type SettlementReconciliationStatus = "matched" | "missing" | "mismatch" | "unexpected";
export type SettlementReconciliationRow = {
  market: Market;
  orderId: string;
  status: SettlementReconciliationStatus;
  expectedNetAmount: number | null;
  actualNetAmount: number | null;
  netDifference: number;
  expectedMarketplaceFee: number | null;
  actualMarketplaceFee: number | null;
  feeDifference: number;
  settlementIds: string[];
};

export type SettlementReconciliationReport = {
  rows: SettlementReconciliationRow[];
  summary: {
    totalOrders: number;
    matched: number;
    missing: number;
    mismatch: number;
    unexpected: number;
    absoluteNetDifference: number;
  };
};

type ActualAggregate = {
  market: Market;
  orderId: string;
  netAmount: number;
  marketplaceFee: number;
  settlementIds: string[];
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Read-only financial reconciliation; it never changes marketplace data. */
export function reconcileSettlements(input: unknown): SettlementReconciliationReport {
  const parsed = reconciliationInputSchema.parse(input);
  const actualByOrder = new Map<string, ActualAggregate>();

  for (const row of parsed.actual) {
    const key = `${row.market}:${row.orderId}`;
    const aggregate = actualByOrder.get(key) ?? {
      market: row.market,
      orderId: row.orderId,
      netAmount: 0,
      marketplaceFee: 0,
      settlementIds: []
    };
    aggregate.netAmount = money(aggregate.netAmount + row.netAmount);
    aggregate.marketplaceFee = money(aggregate.marketplaceFee + row.marketplaceFee);
    aggregate.settlementIds.push(row.settlementId);
    actualByOrder.set(key, aggregate);
  }

  const expectedKeys = new Set<string>();
  const rows: SettlementReconciliationRow[] = [];

  for (const expected of parsed.expected) {
    const key = `${expected.market}:${expected.orderId}`;
    expectedKeys.add(key);
    const actual = actualByOrder.get(key);

    if (!actual) {
      rows.push({
        market: expected.market,
        orderId: expected.orderId,
        status: "missing",
        expectedNetAmount: expected.expectedNetAmount,
        actualNetAmount: null,
        netDifference: money(-expected.expectedNetAmount),
        expectedMarketplaceFee: expected.expectedMarketplaceFee,
        actualMarketplaceFee: null,
        feeDifference: money(-expected.expectedMarketplaceFee),
        settlementIds: []
      });
      continue;
    }

    const netDifference = money(actual.netAmount - expected.expectedNetAmount);
    const feeDifference = money(actual.marketplaceFee - expected.expectedMarketplaceFee);
    const status: SettlementReconciliationStatus =
      Math.abs(netDifference) <= parsed.tolerance && Math.abs(feeDifference) <= parsed.tolerance ? "matched" : "mismatch";

    rows.push({
      market: expected.market,
      orderId: expected.orderId,
      status,
      expectedNetAmount: expected.expectedNetAmount,
      actualNetAmount: actual.netAmount,
      netDifference,
      expectedMarketplaceFee: expected.expectedMarketplaceFee,
      actualMarketplaceFee: actual.marketplaceFee,
      feeDifference,
      settlementIds: [...actual.settlementIds].sort()
    });
  }

  for (const [key, actual] of actualByOrder) {
    if (expectedKeys.has(key)) continue;
    rows.push({
      market: actual.market,
      orderId: actual.orderId,
      status: "unexpected",
      expectedNetAmount: null,
      actualNetAmount: actual.netAmount,
      netDifference: actual.netAmount,
      expectedMarketplaceFee: null,
      actualMarketplaceFee: actual.marketplaceFee,
      feeDifference: actual.marketplaceFee,
      settlementIds: [...actual.settlementIds].sort()
    });
  }

  rows.sort((a, b) => a.market.localeCompare(b.market) || a.orderId.localeCompare(b.orderId));

  return {
    rows,
    summary: {
      totalOrders: rows.length,
      matched: rows.filter((row) => row.status === "matched").length,
      missing: rows.filter((row) => row.status === "missing").length,
      mismatch: rows.filter((row) => row.status === "mismatch").length,
      unexpected: rows.filter((row) => row.status === "unexpected").length,
      absoluteNetDifference: money(rows.reduce((sum, row) => sum + Math.abs(row.netDifference), 0))
    }
  };
}
