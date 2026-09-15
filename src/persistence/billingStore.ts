import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const orderSchema = z.object({
  orderId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  amount: z.number().int().positive(),
  proDays: z.number().int().positive(),
  status: z.enum(["CREATED", "DONE", "FAILED", "CANCELED"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  paymentKey: z.string().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  previousProUntil: z.string().nullable().default(null),
  previousOrderId: z.string().nullable().default(null),
  canceledAt: z.string().nullable().default(null),
  cancelReason: z.string().nullable().default(null)
});

const entitlementSchema = z.object({
  proUntil: z.string(),
  lastOrderId: z.string(),
  updatedAt: z.string()
});

const dataSchema = z.object({
  version: z.literal(1),
  orders: z.record(orderSchema),
  entitlements: z.record(entitlementSchema)
});

type BillingData = z.infer<typeof dataSchema>;
export type BillingOrder = z.infer<typeof orderSchema>;

export type BillingEntitlement = {
  proUntil: string | null;
  active: boolean;
};

export class BillingStore {
  private data: BillingData;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string, data: BillingData) {
    this.data = data;
  }

  static async load(path: string): Promise<BillingStore> {
    try {
      return new BillingStore(path, await readBillingData(path));
    } catch (primaryError) {
      const primaryCode = errorCode(primaryError);
      try {
        const recovered = await readBillingData(backupPath(path));
        await writeSnapshot(path, recovered);
        return new BillingStore(path, recovered);
      } catch (backupError) {
        if (primaryCode === "ENOENT" && errorCode(backupError) === "ENOENT") {
          return new BillingStore(path, emptyBillingData());
        }
        throw primaryError;
      }
    }
  }

  getOrder(orderId: string): BillingOrder | null {
    return this.data.orders[orderId] ?? null;
  }

  entitlement(tenantId: string, now = Date.now()): BillingEntitlement {
    const item = this.data.entitlements[tenantId];
    if (!item) return { proUntil: null, active: false };
    const expires = Date.parse(item.proUntil);
    return { proUntil: item.proUntil, active: Number.isFinite(expires) && expires > now };
  }

  async createOrder(input: {
    orderId: string;
    tenantId: string;
    userId: string;
    amount: number;
    proDays: number;
  }): Promise<BillingOrder> {
    if (this.data.orders[input.orderId]) throw new Error("billing order already exists");
    const now = new Date().toISOString();
    const order: BillingOrder = {
      ...input,
      status: "CREATED",
      createdAt: now,
      updatedAt: now,
      paymentKey: null,
      failureReason: null,
      previousProUntil: null,
      previousOrderId: null,
      canceledAt: null,
      cancelReason: null
    };
    this.data.orders[input.orderId] = order;
    await this.persist();
    return order;
  }

  async failOrder(orderId: string, reason: string): Promise<void> {
    const order = this.data.orders[orderId];
    if (!order || order.status === "DONE" || order.status === "CANCELED") return;
    order.status = "FAILED";
    order.failureReason = reason.slice(0, 500);
    order.updatedAt = new Date().toISOString();
    await this.persist();
  }

  async completeOrder(input: {
    orderId: string;
    paymentKey: string;
    amount: number;
  }): Promise<{ order: BillingOrder; proUntil: string }> {
    const order = this.data.orders[input.orderId];
    if (!order) throw new Error("결제 주문을 찾을 수 없습니다.");
    if (order.amount !== input.amount) throw new Error("결제 금액이 서버 주문금액과 일치하지 않습니다.");
    if (order.status === "CANCELED") throw new Error("이미 취소된 결제 주문입니다.");

    if (order.status === "DONE") {
      if (order.paymentKey !== input.paymentKey) throw new Error("이미 다른 결제로 처리된 주문입니다.");
      const existing = this.data.entitlements[order.tenantId];
      if (!existing) throw new Error("결제 권한 상태가 손상되었습니다.");
      return { order, proUntil: existing.proUntil };
    }

    const existingEntitlement = this.data.entitlements[order.tenantId] ?? null;
    const current = this.entitlement(order.tenantId);
    const base = current.active && current.proUntil ? Date.parse(current.proUntil) : Date.now();
    const proUntil = new Date(base + order.proDays * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    order.status = "DONE";
    order.paymentKey = input.paymentKey;
    order.failureReason = null;
    order.previousProUntil = current.active ? current.proUntil : null;
    order.previousOrderId = current.active && existingEntitlement ? existingEntitlement.lastOrderId : null;
    order.updatedAt = now;
    this.data.entitlements[order.tenantId] = { proUntil, lastOrderId: order.orderId, updatedAt: now };
    await this.persist();
    return { order, proUntil };
  }

  async cancelOrder(orderId: string, paymentKey: string, reason: string): Promise<{ revoked: boolean }> {
    const order = this.data.orders[orderId];
    if (!order) throw new Error("결제 주문을 찾을 수 없습니다.");
    if (order.paymentKey && order.paymentKey !== paymentKey) throw new Error("결제 키가 주문 기록과 일치하지 않습니다.");
    if (order.status === "CANCELED") return { revoked: false };

    const now = new Date().toISOString();
    order.status = "CANCELED";
    order.paymentKey = paymentKey;
    order.canceledAt = now;
    order.cancelReason = reason.slice(0, 200);
    order.updatedAt = now;

    const entitlement = this.data.entitlements[order.tenantId];
    let revoked = false;
    if (entitlement?.lastOrderId === orderId) {
      const previousExpiry = order.previousProUntil ? Date.parse(order.previousProUntil) : NaN;
      if (order.previousProUntil && order.previousOrderId && Number.isFinite(previousExpiry) && previousExpiry > Date.now()) {
        this.data.entitlements[order.tenantId] = {
          proUntil: order.previousProUntil,
          lastOrderId: order.previousOrderId,
          updatedAt: now
        };
      } else {
        delete this.data.entitlements[order.tenantId];
      }
      revoked = true;
    } else if (entitlement && order.status === "CANCELED") {
      // An older payment was canceled outside SellerHub. Suspend paid access rather than risk
      // retaining an entitlement whose chain can no longer be proven correct automatically.
      delete this.data.entitlements[order.tenantId];
      revoked = true;
    }

    await this.persist();
    return { revoked };
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
      try {
        const current = await readFile(this.path, "utf8");
        dataSchema.parse(JSON.parse(current));
        const backupTemp = `${backupPath(this.path)}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(backupTemp, current, { encoding: "utf8", mode: 0o600 });
        await rename(backupTemp, backupPath(this.path));
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          // Preserve the last-known-good backup if the primary billing file was externally corrupted.
        }
      }
      await rename(temp, this.path);
    });
    return this.writeChain;
  }
}

async function readBillingData(path: string): Promise<BillingData> {
  return dataSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function writeSnapshot(path: string, data: BillingData): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.recover.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

function emptyBillingData(): BillingData {
  return { version: 1, orders: {}, entitlements: {} };
}

function backupPath(path: string): string {
  return `${path}.bak`;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
}
