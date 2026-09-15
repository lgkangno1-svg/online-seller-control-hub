import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const legacyTokenSchema = z.string().min(24).max(512);
const accountSchema = z.object({
  token: z.string().min(24).max(512),
  tenantId: z.string().trim().min(1).max(100),
  plan: z.enum(["beta", "free", "pro"]).default("beta"),
  enabled: z.boolean().default(true)
});
const tokenMapSchema = z.record(
  z.string().trim().min(1).max(100),
  z.union([legacyTokenSchema, accountSchema])
);

export type BetaIdentity = {
  userId: string;
  tenantId: string;
  plan: "beta" | "free" | "pro";
};

export interface WebAuthenticator {
  authenticate(authorizationHeader: string | undefined): BetaIdentity | null;
}

export class BetaTokenAuth implements WebAuthenticator {
  private readonly entries: Array<BetaIdentity & { token: string; enabled: boolean }>;

  constructor(rawJson: string) {
    const parsed = tokenMapSchema.parse(JSON.parse(rawJson));
    this.entries = Object.entries(parsed).map(([userId, value]) => {
      if (typeof value === "string") {
        return { userId, tenantId: "demo", plan: "beta" as const, token: value, enabled: true };
      }
      return { userId, tenantId: value.tenantId, plan: value.plan, token: value.token, enabled: value.enabled };
    });
    if (this.entries.length === 0) throw new Error("WEB_BETA_TOKENS must include at least one tester");
  }

  authenticate(authorizationHeader: string | undefined): BetaIdentity | null {
    if (!authorizationHeader?.startsWith("Bearer ")) return null;
    const candidate = authorizationHeader.slice("Bearer ".length).trim();
    if (!candidate) return null;

    for (const entry of this.entries) {
      if (entry.enabled && safeEqual(candidate, entry.token)) {
        return { userId: entry.userId, tenantId: entry.tenantId, plan: entry.plan };
      }
    }
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
