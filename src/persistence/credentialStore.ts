import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { MARKETS, type Market } from "../core/types.js";

const credentialSchemas = {
  naver: z.object({
    clientId: z.string().trim().min(1).max(300),
    clientSecret: z.string().trim().min(1).max(1000),
    accountId: z.string().trim().min(1).max(300).optional()
  }),
  coupang: z.object({
    accessKey: z.string().trim().min(1).max(300),
    secretKey: z.string().trim().min(1).max(1000),
    vendorId: z.string().trim().min(1).max(300)
  }),
  gmarket: z.object({
    // Commercial seller-tool mode keeps operator master credentials on the
    // SellerHub server. These optional legacy fields remain readable so an
    // existing encrypted store can migrate without destructive rewrites.
    masterId: z.string().trim().min(1).max(300).optional(),
    secretKey: z.string().trim().min(1).max(1000).optional(),
    gmarketSellerId: z.string().trim().min(1).max(300),
    issuer: z.string().trim().min(1).max(300).optional()
  }),
  lotteon: z.object({
    apiKey: z.string().trim().min(1).max(2000)
  }),
  toss: z.object({
    accessKey: z.string().trim().min(1).max(300),
    secretKey: z.string().trim().min(1).max(1000)
  }),
  kakao: z.object({
    // The agency Admin App Key is an operator secret in commercial mode.
    // Keep the old optional field for safe migration of existing records.
    adminAppKey: z.string().trim().min(1).max(1000).optional(),
    sellerAppKey: z.string().trim().min(1).max(1000),
    channelIds: z.string().trim().min(1).max(100).default("101")
  })
} satisfies Record<Market, z.ZodTypeAny>;

const encryptedRecordSchema = z.object({
  tenantId: z.string().min(1),
  market: z.enum(MARKETS),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
  updatedAt: z.string().datetime()
});
const encryptedFileSchema = z.array(encryptedRecordSchema);

type EncryptedRecord = z.infer<typeof encryptedRecordSchema>;

export type CredentialStatus = {
  market: Market;
  configured: boolean;
  updatedAt: string | null;
};

export class EncryptedCredentialStore {
  private records: EncryptedRecord[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly key: Buffer | null
  ) {}

  static async create(path: string, base64Key?: string): Promise<EncryptedCredentialStore> {
    const key = parseKey(base64Key);
    const store = new EncryptedCredentialStore(path, key);
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

  statuses(tenantId: string): CredentialStatus[] {
    return MARKETS.map((market) => {
      const record = this.records.find((item) => item.tenantId === tenantId && item.market === market);
      return { market, configured: Boolean(record), updatedAt: record?.updatedAt ?? null };
    });
  }

  async set(tenantId: string, market: Market, input: unknown): Promise<void> {
    if (!this.key) throw new CredentialStoreNotReadyError();
    const credentials = credentialSchemas[market].parse(input);
    const encrypted = encrypt(this.key, JSON.stringify(credentials));
    const record: EncryptedRecord = {
      tenantId,
      market,
      ...encrypted,
      updatedAt: new Date().toISOString()
    };
    await this.enqueueMutation((records) => ({
      records: [...records.filter((item) => !(item.tenantId === tenantId && item.market === market)), record],
      result: undefined
    }));
  }

  async remove(tenantId: string, market: Market): Promise<boolean> {
    return this.enqueueMutation((records) => {
      const nextRecords = records.filter((item) => !(item.tenantId === tenantId && item.market === market));
      if (nextRecords.length === records.length) return { records, result: false, persist: false };
      return { records: nextRecords, result: true };
    });
  }

  get<T = unknown>(tenantId: string, market: Market): T | null {
    if (!this.key) throw new CredentialStoreNotReadyError();
    const record = this.records.find((item) => item.tenantId === tenantId && item.market === market);
    if (!record) return null;
    const plaintext = decrypt(this.key, record);
    return JSON.parse(plaintext) as T;
  }

  private async enqueueMutation<T>(mutate: (records: EncryptedRecord[]) => {
    records: EncryptedRecord[];
    result: T;
    persist?: boolean;
  }): Promise<T> {
    if (!this.key) throw new CredentialStoreNotReadyError();

    const operation = this.writeQueue.then(async () => {
      const mutation = mutate(this.records);
      if (mutation.persist === false) return mutation.result;
      await this.persistRecords(mutation.records);
      // Do not publish a new in-memory state until the encrypted file is durable.
      this.records = mutation.records;
      return mutation.result;
    });

    // A failed filesystem write must reject that caller but must not poison all
    // later writes. Subsequent mutations continue from the last durable state.
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
        // Keep the previous known-good backup if the live file was externally corrupted.
      }
    }
    await writeEncryptedFile(this.path, records, "write");
  }
}

export class CredentialStoreNotReadyError extends Error {
  constructor() {
    super("MARKET_CREDENTIALS_KEY is not configured");
    this.name = "CredentialStoreNotReadyError";
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
  if (key.length !== 32) throw new Error("MARKET_CREDENTIALS_KEY must be a base64-encoded 32-byte key");
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
