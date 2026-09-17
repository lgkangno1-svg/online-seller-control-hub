import assert from "node:assert/strict";
import test from "node:test";
import { buildPayoutForecast } from "../src/settlement/payoutForecast.js";

test("groups expected cash inflows by payout date", () => {
  const result = buildPayoutForecast([
    { market: "naver", expectedPayoutDate: "2026-09-20T01:00:00Z", grossAmount: 100000, fees: 3000 },
    { market: "coupang", expectedPayoutDate: "2026-09-20T09:00:00Z", grossAmount: 50000, refunds: 10000 },
    { market: "gmarket", expectedPayoutDate: "2026-09-21T00:00:00Z", grossAmount: 20000 },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    { date: result[0]?.date, gross: result[0]?.gross, deductions: result[0]?.deductions, net: result[0]?.net },
    { date: "2026-09-20", gross: 150000, deductions: 13000, net: 137000 },
  );
  assert.deepEqual([...(result[0]?.markets ?? [])].sort(), ["coupang", "naver"]);
});
