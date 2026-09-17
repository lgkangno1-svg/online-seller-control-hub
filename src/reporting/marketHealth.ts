import { z } from "zod";
import { MARKETS } from "../core/types.js";

const sampleSchema = z.object({
  market: z.enum(MARKETS),
  checkedAt: z.string().datetime({ offset: true }),
  authOk: z.boolean(),
  latencyMs: z.number().int().nonnegative().max(120000),
  consecutiveFailures: z.number().int().nonnegative().max(100000),
  rateLimited: z.boolean().default(false),
});

export function summarizeMarketHealth(input: unknown) {
  const samples = z.array(sampleSchema).max(1000).parse(input);
  return MARKETS.map((market) => {
    const sample = samples.filter((item) => item.market === market).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
    if (!sample) return { market, status: "unknown" as const, reason: "no_sample" as const };
    if (!sample.authOk) return { market, status: "down" as const, reason: "authentication" as const, checkedAt: sample.checkedAt };
    if (sample.consecutiveFailures >= 3) return { market, status: "down" as const, reason: "repeated_failure" as const, checkedAt: sample.checkedAt };
    if (sample.rateLimited) return { market, status: "degraded" as const, reason: "rate_limit" as const, checkedAt: sample.checkedAt };
    if (sample.latencyMs >= 5000) return { market, status: "degraded" as const, reason: "latency" as const, checkedAt: sample.checkedAt };
    return { market, status: "healthy" as const, reason: "ok" as const, checkedAt: sample.checkedAt };
  });
}
