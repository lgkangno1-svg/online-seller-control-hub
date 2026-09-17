import assert from "node:assert/strict";
import test from "node:test";
import { buildSettlementKpis } from "../src/reporting/settlementKpi.js";

test("aggregates settlement KPIs", () => {
  const r = buildSettlementKpis([
    { market: "naver", grossAmount: 10000, feeAmount: 1000, shippingAmount: 0, settledAmount: 9000 },
    { market: "coupang", grossAmount: 20000, feeAmount: 2000, shippingAmount: 1000, settledAmount: 17000 }
  ]);
  assert.equal(r.gross, 30000);
  assert.equal(r.fees, 3000);
  assert.equal(r.settled, 26000);
  assert.equal(r.byMarket.naver?.rows, 1);
});
