export class SerialRateLimiter {
  private nextAllowedAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  wait(): Promise<void> {
    const task = this.queue.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, this.nextAllowedAt - now);
      if (waitMs > 0) await sleep(waitMs);
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}

export function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, Math.ceil(seconds * 1000));
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(10_000, Math.max(0, at - Date.now()));
  }
  return Math.min(5_000, 400 * 2 ** attempt + Math.floor(Math.random() * 150));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
