import assert from "node:assert/strict";
import test from "node:test";
import { buildAlertDigest, summarizeAlertDigest } from "../src/automation/alertDigest.js";

test("prioritizes critical operational alerts", () => {
  const input = [{ market: "naver", type: "order_backlog", message: "backlog", count: 4 }, { market: "coupang", type: "auth", message: "token expired", count: 1 }];
  assert.equal(buildAlertDigest(input)[0]?.severity, "critical");
  assert.deepEqual(summarizeAlertDigest(input), { total: 5, critical: 1, warning: 0 });
});
