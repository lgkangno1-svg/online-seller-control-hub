import assert from "node:assert/strict";
import test from "node:test";
import {
  accessTokenCacheKey,
  getCachedAccessToken,
  getOrCreateAccessToken,
  invalidateCachedAccessToken
} from "../src/markets/accessTokenCache.js";

test("coalesces concurrent token refreshes for the same credential key", async () => {
  const key = accessTokenCacheKey("naver", "tenant-a", { clientId: "id", clientSecret: "secret" });
  let calls = 0;
  const create = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { accessToken: "token-1", expiresInSeconds: 3600 };
  };

  const [a, b, c] = await Promise.all([
    getOrCreateAccessToken(key, create),
    getOrCreateAccessToken(key, create),
    getOrCreateAccessToken(key, create)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], ["token-1", "token-1", "token-1"]);
  assert.equal(getCachedAccessToken(key), "token-1");
  invalidateCachedAccessToken("token-1");
});

test("failed refresh is not cached and a later attempt can recover", async () => {
  const key = accessTokenCacheKey("naver", "tenant-b", { clientId: "id", clientSecret: "secret" });
  let calls = 0;
  await assert.rejects(() => getOrCreateAccessToken(key, async () => {
    calls += 1;
    throw new Error("temporary oauth failure");
  }), /temporary oauth failure/);

  const token = await getOrCreateAccessToken(key, async () => {
    calls += 1;
    return { accessToken: "token-2", expiresInSeconds: 3600 };
  });

  assert.equal(calls, 2);
  assert.equal(token, "token-2");
  invalidateCachedAccessToken("token-2");
});
