import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type Bucket = {
  attempts: number[];
  lastSeenAt: number;
};

type GuardOptions = {
  loginPerIdentifierLimit?: number;
  loginPerIdentifierWindowMs?: number;
  loginPerSourceLimit?: number;
  loginPerSourceWindowMs?: number;
  globalLoginFailureLimit?: number;
  globalLoginFailureWindowMs?: number;
  signupPerSourceLimit?: number;
  signupPerSourceWindowMs?: number;
  globalSignupLimit?: number;
  globalSignupWindowMs?: number;
  maxTrackedIdentifiers?: number;
  maxTrackedSources?: number;
  now?: () => number;
};

type PersistedState = {
  version: 1;
  loginFailures: Record<string, Bucket>;
  sourceLoginFailures: Record<string, Bucket>;
  sourceSignups: Record<string, Bucket>;
  globalLoginFailures: number[];
  globalSignups: number[];
};

const DEFAULTS = {
  loginPerIdentifierLimit: 8,
  loginPerIdentifierWindowMs: 15 * 60_000,
  loginPerSourceLimit: 40,
  loginPerSourceWindowMs: 15 * 60_000,
  globalLoginFailureLimit: 300,
  globalLoginFailureWindowMs: 10 * 60_000,
  signupPerSourceLimit: 10,
  signupPerSourceWindowMs: 60 * 60_000,
  globalSignupLimit: 60,
  globalSignupWindowMs: 60 * 60_000,
  maxTrackedIdentifiers: 2_000,
  maxTrackedSources: 2_000
} as const;

export class AuthRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "AuthRateLimitError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  }
}

class AuthAbuseStateCorruptError extends Error {
  constructor(path: string) {
    super(`SellerHub auth abuse state is damaged: ${path}`);
    this.name = "AuthAbuseStateCorruptError";
  }
}

export class AuthAbuseGuard {
  private readonly loginFailures = new Map<string, Bucket>();
  private readonly sourceLoginFailures = new Map<string, Bucket>();
  private readonly sourceSignups = new Map<string, Bucket>();
  private readonly globalLoginFailures: number[] = [];
  private readonly globalSignups: number[] = [];
  private readonly options: Required<Omit<GuardOptions, "now">>;
  private readonly now: () => number;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    options: GuardOptions = {},
    private readonly persistencePath?: string,
    initialState?: PersistedState
  ) {
    this.options = {
      loginPerIdentifierLimit: options.loginPerIdentifierLimit ?? DEFAULTS.loginPerIdentifierLimit,
      loginPerIdentifierWindowMs: options.loginPerIdentifierWindowMs ?? DEFAULTS.loginPerIdentifierWindowMs,
      loginPerSourceLimit: options.loginPerSourceLimit ?? DEFAULTS.loginPerSourceLimit,
      loginPerSourceWindowMs: options.loginPerSourceWindowMs ?? DEFAULTS.loginPerSourceWindowMs,
      globalLoginFailureLimit: options.globalLoginFailureLimit ?? DEFAULTS.globalLoginFailureLimit,
      globalLoginFailureWindowMs: options.globalLoginFailureWindowMs ?? DEFAULTS.globalLoginFailureWindowMs,
      signupPerSourceLimit: options.signupPerSourceLimit ?? DEFAULTS.signupPerSourceLimit,
      signupPerSourceWindowMs: options.signupPerSourceWindowMs ?? DEFAULTS.signupPerSourceWindowMs,
      globalSignupLimit: options.globalSignupLimit ?? DEFAULTS.globalSignupLimit,
      globalSignupWindowMs: options.globalSignupWindowMs ?? DEFAULTS.globalSignupWindowMs,
      maxTrackedIdentifiers: options.maxTrackedIdentifiers ?? DEFAULTS.maxTrackedIdentifiers,
      maxTrackedSources: options.maxTrackedSources ?? DEFAULTS.maxTrackedSources
    };
    this.now = options.now ?? Date.now;
    if (initialState) this.restore(initialState);
  }

  static async load(path: string, options: GuardOptions = {}): Promise<AuthAbuseGuard> {
    let primary: PersistedState | null;
    try {
      primary = await readState(path);
    } catch (error) {
      if (!(error instanceof AuthAbuseStateCorruptError)) throw error;
      const backup = await readState(`${path}.bak`);
      if (!backup) throw error;
      const guard = new AuthAbuseGuard(options, path, backup);
      await guard.flushPersistence();
      return guard;
    }
    if (primary) return new AuthAbuseGuard(options, path, primary);

    const backup = await readState(`${path}.bak`);
    if (backup) {
      const guard = new AuthAbuseGuard(options, path, backup);
      await guard.flushPersistence();
      return guard;
    }

    return new AuthAbuseGuard(options, path);
  }

  assertLoginAllowed(identifier: string, sourceKey = "unknown"): void {
    const now = this.now();
    prune(this.globalLoginFailures, now - this.options.globalLoginFailureWindowMs);
    if (this.globalLoginFailures.length >= this.options.globalLoginFailureLimit) {
      throw limited("로그인 시도가 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.", this.globalLoginFailures, this.options.globalLoginFailureWindowMs, now);
    }

    this.assertBucketAllowed(
      this.loginFailures,
      identifierKey(identifier),
      this.options.loginPerIdentifierLimit,
      this.options.loginPerIdentifierWindowMs,
      now,
      "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
    );
    this.assertBucketAllowed(
      this.sourceLoginFailures,
      sourceKeyHash(sourceKey),
      this.options.loginPerSourceLimit,
      this.options.loginPerSourceWindowMs,
      now,
      "현재 접속 위치에서 로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  recordLoginFailure(identifier: string, sourceKey = "unknown"): void {
    const now = this.now();
    prune(this.globalLoginFailures, now - this.options.globalLoginFailureWindowMs);
    this.globalLoginFailures.push(now);

    this.recordBucket(this.loginFailures, identifierKey(identifier), this.options.loginPerIdentifierWindowMs, now);
    this.recordBucket(this.sourceLoginFailures, sourceKeyHash(sourceKey), this.options.loginPerSourceWindowMs, now);
    evictOldest(this.loginFailures, this.options.maxTrackedIdentifiers);
    evictOldest(this.sourceLoginFailures, this.options.maxTrackedSources);
    this.queuePersist();
  }

  recordLoginSuccess(identifier: string): void {
    if (this.loginFailures.delete(identifierKey(identifier))) this.queuePersist();
  }

  assertAndRecordSignupAllowed(sourceKey = "unknown"): void {
    const now = this.now();
    prune(this.globalSignups, now - this.options.globalSignupWindowMs);
    if (this.globalSignups.length >= this.options.globalSignupLimit) {
      throw limited("가입 신청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.", this.globalSignups, this.options.globalSignupWindowMs, now);
    }

    const key = sourceKeyHash(sourceKey);
    this.assertBucketAllowed(
      this.sourceSignups,
      key,
      this.options.signupPerSourceLimit,
      this.options.signupPerSourceWindowMs,
      now,
      "현재 접속 위치에서 가입 신청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
    );
    this.globalSignups.push(now);
    this.recordBucket(this.sourceSignups, key, this.options.signupPerSourceWindowMs, now);
    evictOldest(this.sourceSignups, this.options.maxTrackedSources);
    this.queuePersist();
  }

  async flushPersistence(): Promise<void> {
    if (!this.persistencePath) return;
    this.queuePersist();
    await this.writeChain;
  }

  private restore(state: PersistedState): void {
    const now = this.now();
    restoreBuckets(this.loginFailures, state.loginFailures, now - this.options.loginPerIdentifierWindowMs, this.options.maxTrackedIdentifiers);
    restoreBuckets(this.sourceLoginFailures, state.sourceLoginFailures, now - this.options.loginPerSourceWindowMs, this.options.maxTrackedSources);
    restoreBuckets(this.sourceSignups, state.sourceSignups, now - this.options.signupPerSourceWindowMs, this.options.maxTrackedSources);
    this.globalLoginFailures.push(...state.globalLoginFailures.filter((value) => value > now - this.options.globalLoginFailureWindowMs));
    this.globalSignups.push(...state.globalSignups.filter((value) => value > now - this.options.globalSignupWindowMs));
  }

  private assertBucketAllowed(
    buckets: Map<string, Bucket>,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    message: string
  ): void {
    const bucket = buckets.get(key);
    if (!bucket) return;
    prune(bucket.attempts, now - windowMs);
    if (bucket.attempts.length === 0) {
      buckets.delete(key);
      this.queuePersist();
      return;
    }
    bucket.lastSeenAt = now;
    if (bucket.attempts.length >= limit) throw limited(message, bucket.attempts, windowMs, now);
  }

  private recordBucket(buckets: Map<string, Bucket>, key: string, windowMs: number, now: number): void {
    const bucket = buckets.get(key) ?? { attempts: [], lastSeenAt: now };
    prune(bucket.attempts, now - windowMs);
    bucket.attempts.push(now);
    bucket.lastSeenAt = now;
    buckets.set(key, bucket);
  }

  private queuePersist(): void {
    if (!this.persistencePath) return;
    const snapshot = this.snapshot();
    this.writeChain = this.writeChain
      .then(() => writeState(this.persistencePath!, snapshot))
      .catch((error) => {
        console.error("SellerHub auth abuse state persistence failed", error instanceof Error ? error.message : String(error));
      });
  }

  private snapshot(): PersistedState {
    return {
      version: 1,
      loginFailures: Object.fromEntries(this.loginFailures),
      sourceLoginFailures: Object.fromEntries(this.sourceLoginFailures),
      sourceSignups: Object.fromEntries(this.sourceSignups),
      globalLoginFailures: [...this.globalLoginFailures],
      globalSignups: [...this.globalSignups]
    };
  }
}

function limited(message: string, attempts: number[], windowMs: number, now: number): AuthRateLimitError {
  const first = attempts[0] ?? now;
  return new AuthRateLimitError(message, Math.max(1, first + windowMs - now));
}

function identifierKey(value: string): string {
  return fingerprint(value.trim().toLowerCase().slice(0, 254));
}

function sourceKeyHash(value: string): string {
  const normalized = value.trim().toLowerCase().slice(0, 128) || "unknown";
  return fingerprint(normalized);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function prune(values: number[], cutoff: number): void {
  let count = 0;
  while (count < values.length && values[count]! <= cutoff) count += 1;
  if (count > 0) values.splice(0, count);
}

function evictOldest(buckets: Map<string, Bucket>, maxSize: number): void {
  while (buckets.size > maxSize) {
    let oldestKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of buckets) {
      if (bucket.lastSeenAt < oldest) {
        oldest = bucket.lastSeenAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) return;
    buckets.delete(oldestKey);
  }
}

function restoreBuckets(
  target: Map<string, Bucket>,
  source: Record<string, Bucket>,
  cutoff: number,
  maxSize: number
): void {
  for (const [key, value] of Object.entries(source)) {
    const attempts = value.attempts.filter((attempt) => attempt > cutoff);
    if (attempts.length === 0) continue;
    target.set(key, { attempts, lastSeenAt: value.lastSeenAt });
  }
  evictOldest(target, maxSize);
}

async function readState(path: string): Promise<PersistedState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthAbuseStateCorruptError(path);
  }
  if (!isPersistedState(parsed)) throw new AuthAbuseStateCorruptError(path);
  return parsed;
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if (state.version !== 1) return false;
  if (!isBucketRecord(state.loginFailures) || !isBucketRecord(state.sourceLoginFailures) || !isBucketRecord(state.sourceSignups)) return false;
  return isTimestampArray(state.globalLoginFailures) && isTimestampArray(state.globalSignups);
}

function isBucketRecord(value: unknown): value is Record<string, Bucket> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, bucket] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !bucket || typeof bucket !== "object") return false;
    const candidate = bucket as Record<string, unknown>;
    if (!isTimestampArray(candidate.attempts) || typeof candidate.lastSeenAt !== "number" || !Number.isFinite(candidate.lastSeenAt)) return false;
  }
  return true;
}

function isTimestampArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0);
}

async function writeState(path: string, state: PersistedState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${path}.bak`;
  await writeFile(temp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });

  try {
    const current = await readState(path);
    if (current) {
      const backupTemp = `${backup}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(backupTemp, JSON.stringify(current), { encoding: "utf8", mode: 0o600 });
      await rename(backupTemp, backup);
    }
  } catch {
    // A damaged primary must not overwrite a known-good backup.
  }

  await rename(temp, path);
  await rm(temp, { force: true }).catch(() => undefined);
}
