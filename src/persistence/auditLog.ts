import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApprovalActor } from "../core/approvalStore.js";
import type { Market, MarketExecutionResult, ParsedCommand } from "../core/types.js";
import type { MarketProductRegistrationResult } from "../markets/marketConnectionService.js";

export type ActivityEntry = {
  at: string;
  type: "control_command" | "product_registration";
  actor: ApprovalActor;
  masterSku?: string;
  market?: Market;
  command?: ParsedCommand;
  results?: MarketExecutionResult[];
  result?: MarketProductRegistrationResult;
  payloadSha256?: string;
};

export class AuditLog {
  constructor(private readonly path: string) {}

  async record(entry: {
    actor: ApprovalActor;
    masterSku: string;
    command: ParsedCommand;
    results: MarketExecutionResult[];
  }): Promise<void> {
    await this.append({ type: "control_command", ...entry });
  }

  async recordRegistration(entry: {
    actor: ApprovalActor;
    masterSku: string;
    market: Market;
    payload: unknown;
    result: MarketProductRegistrationResult;
  }): Promise<void> {
    const payloadJson = JSON.stringify(entry.payload);
    await this.append({
      type: "product_registration",
      actor: entry.actor,
      masterSku: entry.masterSku,
      market: entry.market,
      payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
      result: entry.result
    });
  }

  async list(tenantId: string, limit = 100): Promise<ActivityEntry[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const prefix = `${tenantId}:`;
    const entries: ActivityEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const candidate = JSON.parse(line) as Partial<ActivityEntry>;
        if (!candidate.actor || typeof candidate.actor.id !== "string" || !candidate.actor.id.startsWith(prefix)) continue;
        if (candidate.type !== "control_command" && candidate.type !== "product_registration") continue;
        if (typeof candidate.at !== "string") continue;
        entries.push(candidate as ActivityEntry);
      } catch {
        // One corrupted append-only line must not hide the remaining beta history.
      }
    }
    return entries.slice(-safeLimit).reverse();
  }

  private async append(entry: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
