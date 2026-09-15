import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

export type SecurityEventType =
  | "login_success"
  | "login_failure"
  | "login_rate_limited"
  | "signup_requested"
  | "signup_rate_limited"
  | "signup_approved"
  | "signup_rejected";

export type SecurityEvent = {
  at: string;
  type: SecurityEventType;
  identifierHash?: string;
  sourceHash?: string;
  actorUserId?: string;
  subjectUserId?: string;
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const SECURITY_EVENT_TYPES = new Set<SecurityEventType>([
  "login_success",
  "login_failure",
  "login_rate_limited",
  "signup_requested",
  "signup_rate_limited",
  "signup_approved",
  "signup_rejected"
]);

/**
 * Append-only authentication/security history.
 *
 * Raw login identifiers and network source keys are intentionally never written;
 * only SHA-256 fingerprints are persisted. The log is operational telemetry, not
 * an authorization source of truth, so failure to write it must not grant access.
 */
export class SecurityAuditLog {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1_024) {
      throw new Error("security audit maxBytes must be an integer >= 1024");
    }
  }

  record(input: {
    type: SecurityEventType;
    identifier?: string;
    sourceKey?: string;
    actorUserId?: string;
    subjectUserId?: string;
  }): Promise<void> {
    const event: SecurityEvent = {
      at: new Date().toISOString(),
      type: input.type,
      ...(input.identifier ? { identifierHash: fingerprint(input.identifier.trim().toLowerCase()) } : {}),
      ...(input.sourceKey ? { sourceHash: fingerprint(input.sourceKey.trim().toLowerCase()) } : {}),
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.subjectUserId ? { subjectUserId: input.subjectUserId } : {})
    };

    this.writeChain = this.writeChain.then(() => this.append(event));
    return this.writeChain;
  }

  /**
   * Return newest events first, including the single rotated segment.
   * Malformed/truncated lines are ignored because this log is telemetry rather
   * than an authorization source of truth. Reads wait for queued writes first.
   */
  async recent(limit = 100): Promise<SecurityEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("security audit limit must be an integer between 1 and 500");
    }

    await this.writeChain;
    const [rotated, current] = await Promise.all([
      readEvents(`${this.path}.1`),
      readEvents(this.path)
    ]);
    return [...rotated, ...current].slice(-limit).reverse();
  }

  private async append(event: SecurityEvent): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await this.rotateIfNeeded();
    await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private async rotateIfNeeded(): Promise<void> {
    let size = 0;
    try {
      size = (await stat(this.path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (size < this.maxBytes) return;

    const rotated = `${this.path}.1`;
    await rm(rotated, { force: true });
    await rename(this.path, rotated);
  }
}

async function readEvents(path: string): Promise<SecurityEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const events: SecurityEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isSecurityEvent(parsed)) events.push(parsed);
    } catch {
      // A crash can leave a final JSONL record truncated. Preserve the readable
      // history instead of making the administrator lose the entire audit view.
    }
  }
  return events;
}

function isSecurityEvent(value: unknown): value is SecurityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at))) return false;
  if (typeof event.type !== "string" || !SECURITY_EVENT_TYPES.has(event.type as SecurityEventType)) return false;
  for (const key of ["identifierHash", "sourceHash", "actorUserId", "subjectUserId"] as const) {
    if (event[key] !== undefined && typeof event[key] !== "string") return false;
  }
  return true;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
