import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const encryptedRecordSchema = z.object({
  tenantId: z.string().min(1).max(200),
  market: z.enum(MARKETS),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
  updatedAt: z.string().datetime()
});
const encryptedFileSchema = z.array(encryptedRecordSchema);
const linkPayloadSchema = z.object({
  externalAccountId: z.string().min(1).max(1000),
  source: z.string().min(1).max(100)
});

type EncryptedRecord = z.infer<typeof encryptedRecordSchema>;

export type MarketplaceLinkStatus = {
  market: Market;
  linked: boolean;
  updatedAt: string | null;
};

export type MarketplaceLink = {
  market: Market;
  externalAccountId: string;
  source: string;
  updatedAt: string;
};

/**
 * Stores provider-issued seller identifiers encrypted at rest.
 * Raw provider account identifiers are never present in the JSON file.
 */
export class MarketplaceLinkStore {
  private records: EncryptedRecord[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly key: Buffer | null
  ) {}

  static async create(path: string, base64Key?: string): Promise<MarketplaceLinkStore> {
    const key = parseKey(base64Key);
    const store = new MarketplaceLinkStore(path, key);
    try {
      store.records = await readEncryptedFile(path);
    } catch (primaryError) {
      const primaryCode = errorCode(primaryError);
      try {
        store.records = await readEncryptedFile(backupPath(path));
        await writeEncryptedFile(path, store.records, "recover");
      } catch (backupError) {
        if (primaryCode !== "ENOENT" || errorCode(backupError) !== "ENOENT") throw primaryError;
      }
    }
    return store;
  }

  get ready(): boolean {
    return this.key !== null;
  }

  statuses(tenantId: string): MarketplaceLinkStatus[] {
    return MARKETS.map((market) => {
      const record = this.records.find((item) => item.tenantId === tenantId && item.market === market);
      return { market, linked: Boolean(record), updatedAt: record?.updatedAt ?? null };
    });
  }

  async set(tenantId: string, market: Market, externalAccountId: string, source: string): Promise<void> {
    if (!this.key) throw new MarketplaceLinkStoreNotReadyError();
    const payload = linkPayloadSchema.parse({ externalAccountId, source });

    await this.enqueueMutation((records) => {
      const owner = this.tenantForExternalAccountIdIn(records, market, payload.externalAccountId);
      if (owner && owner !== tenantId) {
        throw new MarketplaceAccountAlreadyLinkedError(market);
      }
      const current = this.getFromRecords(records, tenantId, market);
      if (current && current.externalAccountId !== payload.externalAccountId) {
        throw new MarketplaceRelinkRequiredError(market);
      }

      const encrypted = encrypt(this.key!, JSON.stringify(payload));
      const record: EncryptedRecord = {
        tenantId,
        market,
        ...encrypted,
        updatedAt: new Date().toISOString()
      };
      return {
        records: [...records.filter((item) => !(item.tenantId === tenantId && item.market === market)), record],
        result: undefined
      };
    });
  }

  get(tenantId: string, market: Market): MarketplaceLink | null {
    if (!this.key) throw new MarketplaceLinkStoreNotReadyError();
    return this.getFromRecords(this.records, tenantId, market);
  }

  tenantForExternalAccountId(market: Market, externalAccountId: string): string | null {
    if (!this.key) throw new MarketplaceLinkStoreNotReadyError();
    return this.tenantForExternalAccountIdIn(this.records, market, externalAccountId);
  }

  async remove(tenantId: string, market: Market): Promise<boolean> {
    return this.enqueueMutation((records) => {
      const nextRecords = records.filter((item) => !(item.tenantId === tenantId && item.market === market));
      if (nextRecords.length === records.length) return { records, result: false, persist: false };
      return { records: nextRecords, result: true };
    });
  }

  private getFromRecords(records: EncryptedRecord[], tenantId: string, market: Market): MarketplaceLink | null {
    if (!this.key) throw new MarketplaceLinkStoreNotReadyError();
    const record = records.find((item) => item.tenantId === tenantId && item.market === market);
    if (!record) return null;
    const payload = linkPayloadSchema.parse(JSON.parse(decrypt(this.key, record)));
    return { market, ...payload, updatedAt: record.updatedAt };
  }

  private tenantForExternalAccountIdIn(records: EncryptedRecord[], market: Market, externalAccountId: string): string | null {
    if (!this.key) throw new MarketplaceLinkStoreNotReadyError();
    for (const record of records) {
      if (record.market !== market) continue;
      const payload = linkPayloadSchema.parse(JSON.parse(decrypt(this.key, record)));
      if (payload.externalAccountId === externalAccountId) return record.tenantId;
    }
    return null;
  }

  private async enqueueMutation<T>(mutate: (records: EncryptedRecord[]) => {
    records: EncryptedRecord[];
    result: T;
    persist?: boolean;
  }): Promise<T> {
    if (!this.key) throw new MarketplaceLinkStoreNotReadyError();

    const operation = this.writeQueue.then(async () => {
      const mutation = mutate(this.records);
      if (mutation.persist === false) return mutation.result;
      await this.persistRecords(mutation.records);
      // Publish a delegated link only after the encrypted snapshot is durable.
      this.records = mutation.records;
      return mutation.result;
    });

    // A failed filesystem write rejects only that caller. Future link/unlink
    // operations resume from the last durable in-memory snapshot.
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persistRecords(records: EncryptedRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const current = await readFile(this.path, "utf8");
      encryptedFileSchema.parse(JSON.parse(current));
      await writeRawFile(backupPath(this.path), current, "backup");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        // Preserve the last known-good backup if the primary was corrupted.
      }
    }
    await writeEncryptedFile(this.path, records, "write");
  }
}

export class MarketplaceLinkStoreNotReadyError extends Error {
  constructor() {
    super("MARKET_LINKS_KEY is not configured");
    this.name = "MarketplaceLinkStoreNotReadyError";
  }
}

export class MarketplaceAccountAlreadyLinkedError extends Error {
  constructor(market: Market) {
    super(`${market} seller account is already linked to another SellerHub tenant`);
    this.name = "MarketplaceAccountAlreadyLinkedError";
  }
}

export class MarketplaceRelinkRequiredError extends Error {
  constructor(market: Market) {
    super(`${market} seller account replacement requires unlinking the existing account first`);
    this.name = "MarketplaceRelinkRequiredError";
  }
}

async function readEncryptedFile(path: string): Promise<EncryptedRecord[]> {
  return encryptedFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function writeEncryptedFile(path: string, records: EncryptedRecord[], suffix: string): Promise<void> {
  await writeRawFile(path, `${JSON.stringify(records, null, 2)}\n`, suffix);
}

async function writeRawFile(path: string, content: string, suffix: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.${suffix}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

function backupPath(path: string): string {
  return `${path}.bak`;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
}

function parseKey(value?: string): Buffer | null {
  if (!value?.trim()) return null;
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) throw new Error("MARKET_LINKS_KEY must be a base64-encoded 32-byte key");
  return key;
}

function encrypt(key: Buffer, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decrypt(key: Buffer, record: Pick<EncryptedRecord, "iv" | "tag" | "ciphertext">): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}
