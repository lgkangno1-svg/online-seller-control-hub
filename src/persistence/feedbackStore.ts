import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class FeedbackStore {
  constructor(private readonly path: string) {}

  async record(entry: {
    userId: string;
    tenantId: string;
    score: number;
    message: string;
    page: string;
    userAgent: string | null;
  }): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(
      this.path,
      `${JSON.stringify({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry })}\n`,
      "utf8"
    );
  }
}
