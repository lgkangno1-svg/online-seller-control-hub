import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableStatus, retryAfterMs } from "../src/markets/rateLimiter.js";

test("market retry policy is limited to throttling and transient gateway failures", () => {
  for (const status of [429, 502, 503, 504]) assert.equal(isRetryableStatus(status), true, String(status));
  for (const status of [400, 401, 403, 404, 409, 422, 500]) assert.equal(isRetryableStatus(status), false, String(status));
});

test("Retry-After seconds are honored with a hard safety cap", () => {
  const short = new Response("", { status: 429, headers: { "Retry-After": "2" } });
  assert.equal(retryAfterMs(short, 0), 2000);

  const huge = new Response("", { status: 429, headers: { "Retry-After": "999" } });
  assert.equal(retryAfterMs(huge, 0), 10_000);
});
