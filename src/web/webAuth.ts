import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AccountIdentity, AccountStore, SignupRequest } from "../persistence/accountStore.js";
import type { SecurityAuditLog, SecurityEventType } from "../persistence/securityAuditLog.js";
import { AuthAbuseGuard, AuthRateLimitError } from "./authAbuseGuard.js";
import { safeAuthError } from "./authErrorPolicy.js";

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

export type WebIdentity = {
  userId: string;
  tenantId: string;
  plan: "beta" | "free" | "pro";
  role: "owner" | "member" | "admin";
  email: string | null;
  username: string | null;
  authKind: "account" | "legacy-beta";
};

type LegacyEntry = Omit<WebIdentity, "email" | "username" | "role" | "authKind"> & { token: string; enabled: boolean };

export class WebAuth {
  private readonly legacyEntries: LegacyEntry[];
  private readonly abuseGuard: AuthAbuseGuard;

  constructor(
    private readonly accounts: AccountStore,
    rawLegacyJson: string | undefined,
    private readonly signupEnabled: boolean,
    _inviteCode: string | null,
    abuseGuard = new AuthAbuseGuard(),
    private readonly securityAudit?: SecurityAuditLog
  ) {
    this.legacyEntries = parseLegacy(rawLegacyJson);
    this.abuseGuard = abuseGuard;
  }

  authenticate(authorizationHeader: string | undefined): WebIdentity | null {
    const token = bearer(authorizationHeader);
    if (!token) return null;

    const account = this.accounts.authenticate(token);
    if (account) return fromAccount(account);

    for (const entry of this.legacyEntries) {
      if (entry.enabled && safeEqual(token, entry.token)) {
        return {
          userId: entry.userId,
          tenantId: entry.tenantId,
          plan: entry.plan,
          role: "owner",
          email: null,
          username: null,
          authKind: "legacy-beta"
        };
      }
    }
    return null;
  }

  async login(identifier: string, password: string, sourceKey = "unknown") {
    try {
      this.abuseGuard.assertLoginAllowed(identifier, sourceKey);
    } catch (error) {
      if (error instanceof AuthRateLimitError) {
        await this.recordSecurity("login_rate_limited", { identifier, sourceKey });
      }
      throw error;
    }

    try {
      const result = await this.accounts.login(identifier, password);
      this.abuseGuard.recordLoginSuccess(identifier);
      await this.recordSecurity("login_success", { identifier, sourceKey, subjectUserId: result.identity.userId });
      return {
        token: result.token,
        expiresAt: result.expiresAt,
        identity: fromAccount(result.identity)
      };
    } catch (error) {
      this.abuseGuard.recordLoginFailure(identifier, sourceKey);
      await this.recordSecurity("login_failure", { identifier, sourceKey });
      throw safeAuthError("login", error);
    }
  }

  async requestSignup(
    input: { email: string; password: string },
    sourceKey = "unknown"
  ): Promise<{ status: "pending"; request: SignupRequest }> {
    if (!this.signupEnabled) throw new Error("현재 신규 가입 신청을 받지 않고 있습니다.");
    try {
      this.abuseGuard.assertAndRecordSignupAllowed(sourceKey);
    } catch (error) {
      if (error instanceof AuthRateLimitError) {
        await this.recordSecurity("signup_rate_limited", { identifier: input.email, sourceKey });
      }
      throw error;
    }

    try {
      const request = await this.accounts.requestSignup(input);
      await this.recordSecurity("signup_requested", { identifier: input.email, sourceKey, subjectUserId: request.userId });
      return { status: "pending", request };
    } catch (error) {
      throw safeAuthError("signup", error);
    }
  }

  signupRequests(): SignupRequest[] {
    return this.accounts.listSignupRequests();
  }

  async approveSignup(userId: string, actorUserId?: string): Promise<SignupRequest> {
    try {
      const request = await this.accounts.approveSignup(userId);
      await this.recordSecurity("signup_approved", {
        ...(actorUserId ? { actorUserId } : {}),
        subjectUserId: userId
      });
      return request;
    } catch (error) {
      throw safeAuthError("signup_admin", error);
    }
  }

  async rejectSignup(userId: string, actorUserId?: string): Promise<SignupRequest> {
    try {
      const request = await this.accounts.rejectSignup(userId);
      await this.recordSecurity("signup_rejected", {
        ...(actorUserId ? { actorUserId } : {}),
        subjectUserId: userId
      });
      return request;
    } catch (error) {
      throw safeAuthError("signup_admin", error);
    }
  }

  async logout(authorizationHeader: string | undefined): Promise<boolean> {
    const token = bearer(authorizationHeader);
    if (!token) return false;
    return this.accounts.logout(token);
  }

  signupAvailable(): boolean {
    return this.signupEnabled;
  }

  private async recordSecurity(
    type: SecurityEventType,
    details: { identifier?: string; sourceKey?: string; actorUserId?: string; subjectUserId?: string }
  ): Promise<void> {
    if (!this.securityAudit) return;
    try {
      await this.securityAudit.record({ type, ...details });
    } catch {
      // Security telemetry must never turn a denied request into an allowed one or
      // make a valid account unavailable solely because the audit disk is unhealthy.
      console.error(`SellerHub security audit write failed for event=${type}`);
    }
  }
}

function parseLegacy(raw: string | undefined): LegacyEntry[] {
  if (!raw?.trim()) return [];
  const parsed = tokenMapSchema.parse(JSON.parse(raw));
  return Object.entries(parsed).map(([userId, value]) => {
    if (typeof value === "string") {
      return { userId, tenantId: "demo", plan: "beta" as const, token: value, enabled: true };
    }
    return { userId, tenantId: value.tenantId, plan: value.plan, token: value.token, enabled: value.enabled };
  });
}

function fromAccount(identity: AccountIdentity): WebIdentity {
  return {
    userId: identity.userId,
    tenantId: identity.tenantId,
    plan: identity.plan,
    role: identity.role,
    email: identity.email,
    username: identity.username ?? null,
    authKind: "account"
  };
}

function bearer(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
