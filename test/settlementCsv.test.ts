import assert from "node:assert/strict";
import test from "node:test";
import { importSettlementCsv, settlementCsvTemplate } from "../src/settlement/settlementCsv.js";
import { reconcileSettlements } from "../src/settlement/settlementReconciliation.js";

test("imports normalized settlement CSV and feeds reconciliation", () => {
  const result = importSettlementCsv([
    "market,settlementId,orderId,netAmount,marketplaceFee,settledAt",
    'naver,s-1,o-1,"4,000",400,2026-09-17T01:00:00+00:00',
    'naver,s-2,o-1,"5,000",600,2026-09-17T02:00:00+00:00'
  ].join("\n"));

  assert.deepEqual(result.errors, []);
  assert.equal(result.settlements.length, 2);
  const report = reconcileSettlements({
    expected: [{ market: "naver", orderId: "o-1", expectedNetAmount: 9000, expectedMarketplaceFee: 1000 }],
    actual: result.settlements
  });
  assert.equal(report.rows[0]?.status, "matched");
});

test("reports invalid money, market and timestamps without importing bad rows", () => {
  const result = importSettlementCsv([
    "market,settlementId,orderId,netAmount,marketplaceFee,settledAt",
    "unknown,s-1,o-1,1000,10,2026-09-17T01:00:00+00:00",
    "naver,s-2,o-2,abc,10,2026-09-17T01:00:00+00:00",
    "naver,s-3,o-3,1000,-1,not-a-date"
  ].join("\n"));

  assert.equal(result.settlements.length, 0);
  assert.equal(result.errors.length, 3);
});

test("blocks duplicate marketplace settlement ids", () => {
  const result = importSettlementCsv([
    "market,settlementId,orderId,netAmount,marketplaceFee,settledAt",
    "toss,same,o-1,1000,100,2026-09-17T01:00:00+00:00",
    "toss,same,o-2,2000,200,2026-09-17T02:00:00+00:00"
  ].join("\n"));

  assert.equal(result.settlements.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? "", /duplicate marketplace settlement/);
});

test("validates template, BOM and quoted fields", () => {
  assert.equal(settlementCsvTemplate(), "market,settlementId,orderId,netAmount,marketplaceFee,settledAt\n");

  const withBom = importSettlementCsv("\uFEFFmarket,settlementId,orderId,netAmount,marketplaceFee,settledAt\nnaver,s-1,o-1,1000,,2026-09-17T01:00:00+00:00\n");
  assert.equal(withBom.errors.length, 0);
  assert.equal(withBom.settlements[0]?.marketplaceFee, 0);

  const badHeader = importSettlementCsv("market,orderId\nnaver,o-1\n");
  assert.match(badHeader.errors[0]?.message ?? "", /expected headers/);

  const unterminated = importSettlementCsv('market,settlementId,orderId,netAmount,marketplaceFee,settledAt\nnaver,"broken,o-1,1000,0,2026-09-17T01:00:00+00:00');
  assert.match(unterminated.errors[0]?.message ?? "", /unterminated quoted CSV field/);
});
