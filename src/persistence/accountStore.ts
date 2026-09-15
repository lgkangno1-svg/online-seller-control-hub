import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compare, hash } from "bcryptjs";
import { z } from "zod";

const MAX_ACTIVE_SESSIONS_PER_USER = 5;
const MISSING_ACCOUNT_HASH = "$2b$12$1coRGR9HP0n4u0K2m91E9OdQMOi/7yOJdGWTVcqjqBAzBxn93w4iS";
const planSchema = z.enum(["beta", "free", "pro"]);
const roleSchema = z.enum(["owner", "member", "admin"]);
const accountStatusSchema = z.enum(["pending", "active", "rejected"]);
const accountSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  email: z.string().email(),
  username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/).optional(),
  passwordHash: z.string(),
  plan: planSchema,
  role: roleSchema,
  status: accountStatusSchema.default("active"),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const sessionSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  tokenHash: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastSeenAt: z.string()
});
const storeSchema = z.object({
  version: z.literal(1),
  accounts: z.record(accountSchema),
  sessions: z.record(sessionSchema)
});

type StoreData = z.infer<typeof storeSchema>;
export type AccountPlan = z.infer<typeof planSchema>;
export type AccountRole = z.infer<typeof roleSchema>;
export type AccountStatus = z.infer<typeof accountStatusSchema>;
export type SellerAccount = z.infer<typeof accountSchema>;
export type AccountIdentity = Pick<SellerAccount, "userId" | "tenantId" | "email" | "username" | "plan" | "role" | "status">;
export type SignupRequest = Pick<SellerAccount, "userId" | "email" | "username" | "status" | "createdAt" | "updatedAt">;

export class AccountStore {
  private data: StoreData;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    data: StoreData,
    private readonly sessionTtlMs: number
  ) {
    this.data = data;
  }

  static async load(path: string, sessionTtlDays = 7): Promise<AccountStore> {
    if (!Number.isInteger(sessionTtlDays) || sessionTtlDays < 1 || sessionTtlDays > 90) {
      throw new Error("ACCOUNT_SESSION_DAYS must be an integer between 1 and 90");
    }
    const ttlMs = sessionTtlDays * 24 * 60 * 60 * 1000;
    try {
      const parsed = await readStore(path);
      return new AccountStore(path, parsed, ttlMs);
    } catch (primaryError) {
      const primaryCode = errorCode(primaryError);
      try {
        const recovered = await readStore(backupPath(path));
        await writeSnapshot(path, recovered);
        return new AccountStore(path, recovered, ttlMs);
      } catch (backupError) {
        if (primaryCode === "ENOENT" && errorCode(backupError) === "ENOENT") {
          return new AccountStore(path, { version: 1, accounts: {}, sessions: {} }, ttlMs);
        }
        throw primaryError;
      }
    }
  }

  async register(input: {
    email: string;
    password: string;
    username?: string;
    plan?: AccountPlan;
    role?: AccountRole;
    status?: AccountStatus;
  }): Promise<AccountIdentity> {
    const email = normalizeEmail(input.email);
    const username = input.username ? normalizeUsername(input.username) : undefined;
    validatePassword(input.password);
    const passwordHash = await hash(input.password, 12);

    return this.enqueueMutation((data) => {
      if (findByEmail(data, email)) throw new Error("이미 가입 또는 가입 신청된 이메일입니다.");
      if (username && findByUsername(data, username)) throw new Error("이미 사용 중인 아이디입니다.");

      const now = new Date().toISOString();
      const userId = `usr_${randomUUID()}`;
      const account: SellerAccount = {
        userId,
        tenantId: `shop_${randomUUID()}`,
        email,
        ...(username ? { username } : {}),
        passwordHash,
        plan: input.plan ?? "free",
        role: input.role ?? "owner",
        status: input.status ?? "active",
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      data.accounts[userId] = account;
      return publicIdentity(account);
    });
  }

  async requestSignup(input: { email: string; password: string }): Promise<SignupRequest> {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const passwordHash = await hash(input.password, 12);

    return this.enqueueMutation((data) => {
      if (findByEmail(data, email)) throw new Error("이미 가입 또는 가입 신청된 이메일입니다.");
      const now = new Date().toISOString();
      const userId = `usr_${randomUUID()}`;
      const account: SellerAccount = {
        userId,
        tenantId: `shop_${randomUUID()}`,
        email,
        passwordHash,
        plan: "free",
        role: "owner",
        status: "pending",
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      data.accounts[userId] = account;
      return signupRequest(account);
    });
  }

  async login(identifierInput: string, password: string): Promise<{ identity: AccountIdentity; token: string; expiresAt: string }> {
    const identifier = normalizeIdentifier(identifierInput);

    return this.enqueueMutation(async (data) => {
      const account = identifier.includes("@") ? findByEmail(data, identifier) : findByUsername(data, identifier);
      // Run one bcrypt comparison even for missing users to reduce account-enumeration timing differences.
      const candidateHash = account?.passwordHash ?? MISSING_ACCOUNT_HASH;
      const valid = await compare(password, candidateHash).catch(() => false);
      if (!account || !account.enabled || account.status !== "active" || !valid) {
        if (account?.status === "pending" && valid) throw new Error("가입 승인 대기 중입니다. 운영자 승인 후 로그인할 수 있습니다.");
        if (account?.status === "rejected" && valid) throw new Error("가입 신청이 승인되지 않았습니다. 운영자에게 문의해 주세요.");
        throw new Error("아이디/이메일 또는 비밀번호가 올바르지 않습니다.");
      }

      const token = randomBytes(32).toString("base64url");
      const sessionId = `ses_${randomUUID()}`;
      const now = Date.now();
      const createdAt = new Date(now).toISOString();
      const expiresAt = new Date(now + this.sessionTtlMs).toISOString();
      pruneExpiredSessions(data, now);
      enforceSessionLimit(data, account.userId, MAX_ACTIVE_SESSIONS_PER_USER - 1);
      data.sessions[sessionId] = {
        sessionId,
        userId: account.userId,
        tokenHash: sha256(token),
        createdAt,
        expiresAt,
        lastSeenAt: createdAt
      };
      return { identity: publicIdentity(account), token, expiresAt };
    });
  }

  authenticate(token: string, now = Date.now()): AccountIdentity | null {
    if (!token || token.length < 32 || token.length > 512) return null;
    const candidate = sha256(token);
    for (const session of Object.values(this.data.sessions)) {
      if (session.tokenHash !== candidate) continue;
      if (Date.parse(session.expiresAt) <= now) return null;
      const account = this.data.accounts[session.userId];
      if (!account?.enabled || account.status !== "active") return null;
      return publicIdentity(account);
    }
    return null;
  }

  async logout(token: string): Promise<boolean> {
    const hashValue = sha256(token);
    return this.enqueueMutation((data) => {
      const session = Object.values(data.sessions).find((item) => item.tokenHash === hashValue);
      if (!session) return false;
      delete data.sessions[session.sessionId];
      return true;
    });
  }

  listSignupRequests(): SignupRequest[] {
    return Object.values(this.data.accounts)
      .filter((account) => account.status === "pending")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map(signupRequest);
  }

  async approveSignup(userId: string): Promise<SignupRequest> {
    return this.enqueueMutation((data) => {
      const account = data.accounts[userId];
      if (!account) throw new Error("가입 신청을 찾을 수 없습니다.");
      if (account.status !== "pending") throw new Error("이미 처리된 가입 신청입니다.");
      account.status = "active";
      account.enabled = true;
      account.updatedAt = new Date().toISOString();
      return signupRequest(account);
    });
  }

  async rejectSignup(userId: string): Promise<SignupRequest> {
    return this.enqueueMutation((data) => {
      const account = data.accounts[userId];
      if (!account) throw new Error("가입 신청을 찾을 수 없습니다.");
      if (account.status !== "pending") throw new Error("이미 처리된 가입 신청입니다.");
      account.status = "rejected";
      account.updatedAt = new Date().toISOString();
      revokeSessions(data, account.userId);
      return signupRequest(account);
    });
  }

  async bootstrapAdmin(input: { username: string; password: string }): Promise<AccountIdentity> {
    const username = normalizeUsername(input.username);
    validatePassword(input.password);

    return this.enqueueMutation(async (data) => {
      const existing = findByUsername(data, username);
      const now = new Date().toISOString();

      if (existing) {
        const passwordMatches = await compare(input.password, existing.passwordHash).catch(() => false);
        if (!passwordMatches) {
          existing.passwordHash = await hash(input.password, 12);
          revokeSessions(data, existing.userId);
        }
        existing.role = "admin";
        existing.plan = "pro";
        existing.status = "active";
        existing.enabled = true;
        existing.updatedAt = now;
        return publicIdentity(existing);
      }

      const userId = `usr_${randomUUID()}`;
      const account: SellerAccount = {
        userId,
        tenantId: `admin_${randomUUID()}`,
        email: `${username}@admin.sellerhub.local`,
        username,
        passwordHash: await hash(input.password, 12),
        plan: "pro",
        role: "admin",
        status: "active",
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      data.accounts[userId] = account;
      return publicIdentity(account);
    });
  }

  accountCount(): number {
    return Object.keys(this.data.accounts).length;
  }

  private enqueueMutation<T>(mutate: (draft: StoreData) => T | Promise<T>): Promise<T> {
    const operation = this.writeChain.then(async () => {
      const draft = cloneStoreData(this.data);
      const result = await mutate(draft);
      await persistStore(this.path, draft);
      // Publish only after the corresponding snapshot is durable.
      this.data = draft;
      return result;
    });

    // A single storage failure must reject its caller without permanently
    // poisoning every later account mutation.
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

async function readStore(path: string): Promise<StoreData> {
  return storeSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function persistStore(path: string, data: StoreData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    const current = await readFile(path, "utf8");
    storeSchema.parse(JSON.parse(current));
    const backupTemp = `${backupPath(path)}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(backupTemp, current, { encoding: "utf8", mode: 0o600 });
    await rename(backupTemp, backupPath(path));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      // Preserve the previous known-good backup if the live file is malformed
      // or backup refresh itself is temporarily unavailable.
    }
  }
  await rename(temp, path);
}

async function writeSnapshot(path: string, data: StoreData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.recover.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

function cloneStoreData(data: StoreData): StoreData {
  return {
    version: 1,
    accounts: Object.fromEntries(
      Object.entries(data.accounts).map(([id, account]) => [id, { ...account }])
    ),
    sessions: Object.fromEntries(
      Object.entries(data.sessions).map(([id, session]) => [id, { ...session }])
    )
  };
}

function findByEmail(data: StoreData, email: string): SellerAccount | null {
  return Object.values(data.accounts).find((account) => account.email === email) ?? null;
}

function findByUsername(data: StoreData, username: string): SellerAccount | null {
  const normalized = username.toLowerCase();
  return Object.values(data.accounts).find((account) => account.username?.toLowerCase() === normalized) ?? null;
}

function revokeSessions(data: StoreData, userId: string) {
  for (const [sessionId, session] of Object.entries(data.sessions)) {
    if (session.userId === userId) delete data.sessions[sessionId];
  }
}

function enforceSessionLimit(data: StoreData, userId: string, maxExisting: number) {
  const sessions = Object.values(data.sessions)
    .filter((session) => session.userId === userId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const removeCount = Math.max(0, sessions.length - maxExisting);
  for (let index = 0; index < removeCount; index += 1) {
    delete data.sessions[sessions[index]!.sessionId];
  }
}

function pruneExpiredSessions(data: StoreData, now: number) {
  for (const [id, session] of Object.entries(data.sessions)) {
    if (Date.parse(session.expiresAt) <= now) delete data.sessions[id];
  }
}

function backupPath(path: string): string {
  return `${path}.bak`;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
}

function normalizeEmail(value: string): string {
  return z.string().trim().toLowerCase().email().max(254).parse(value);
}

function normalizeUsername(value: string): string {
  return z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/).parse(value);
}

function normalizeIdentifier(value: string): string {
  const normalized = z.string().trim().min(3).max(254).parse(value);
  return normalized.includes("@") ? normalized.toLowerCase() : normalized;
}

function validatePassword(value: string) {
  if (value.length < 10 || value.length > 128) throw new Error("비밀번호는 10~128자로 설정해 주세요.");
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) throw new Error("비밀번호에는 영문과 숫자를 모두 포함해 주세요.");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publicIdentity(account: SellerAccount): AccountIdentity {
  return {
    userId: account.userId,
    tenantId: account.tenantId,
    email: account.email,
    ...(account.username ? { username: account.username } : {}),
    plan: account.plan,
    role: account.role,
    status: account.status
  };
}

function signupRequest(account: SellerAccount): SignupRequest {
  return {
    userId: account.userId,
    email: account.email,
    ...(account.username ? { username: account.username } : {}),
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}
