import { createHash } from "node:crypto";

type TokenEntry = {
  accessToken: string;
  expiresAt: number;
};

type CreatedToken = {
  accessToken: string;
  expiresInSeconds: number;
};

const cache = new Map<string, TokenEntry>();
const inFlight = new Map<string, Promise<string>>();

export function accessTokenCacheKey(market: string, tenantId: string, credentials: unknown): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(credentials))
    .digest("hex")
    .slice(0, 24);
  return `${market}:${tenantId}:${fingerprint}`;
}

export function getCachedAccessToken(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.accessToken;
}

export function setCachedAccessToken(key: string, accessToken: string, expiresInSeconds: number): void {
  const ttlMs = Math.max(60, Math.trunc(expiresInSeconds)) * 1000;
  // Refresh a little before the marketplace's advertised expiry time.
  const safetyMs = Math.min(60_000, Math.max(5_000, Math.trunc(ttlMs * 0.05)));
  cache.set(key, { accessToken, expiresAt: Date.now() + ttlMs - safetyMs });
}

export async function getOrCreateAccessToken(
  key: string,
  create: () => Promise<CreatedToken>
): Promise<string> {
  const cached = getCachedAccessToken(key);
  if (cached) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const token = await create();
    setCachedAccessToken(key, token.accessToken, token.expiresInSeconds);
    return token.accessToken;
  })();
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

export function invalidateCachedAccessToken(accessToken: string): void {
  for (const [key, entry] of cache) {
    if (entry.accessToken === accessToken) cache.delete(key);
  }
}
