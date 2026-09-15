import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { BillingStore } from "../persistence/billingStore.js";

const createPaymentSchema = z.object({
  orderId: z.string(),
  status: z.string().optional(),
  checkout: z.object({ url: z.string().url() })
});

const paymentSchema = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  totalAmount: z.number(),
  status: z.string()
});

const webhookSchema = z.object({
  eventType: z.string(),
  createdAt: z.string().optional(),
  data: z.record(z.unknown())
});

export type BillingIdentity = {
  userId: string;
  tenantId: string;
  basePlan: "beta" | "free" | "pro";
};

export type BillingStatus = {
  enabled: boolean;
  provider: "toss-payments";
  effectivePlan: "beta" | "free" | "pro";
  proUntil: string | null;
  price: number | null;
  proDays: number;
  checkoutMode: "disabled" | "test" | "live";
  webhookReady: boolean;
  freeProductLimit: number;
  freeMarketLimit: number;
};

export class TossPaymentsBillingService {
  private readonly enabled: boolean;
  private readonly checkoutMode: "disabled" | "test" | "live";
  private readonly configured: boolean;

  constructor(
    private readonly store: BillingStore,
    private readonly secretKey: string | null,
    private readonly publicBaseUrl: string | null,
    private readonly price: number | null,
    private readonly proDays: number,
    readonly freeProductLimit: number,
    readonly freeMarketLimit: number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly webhookReady = false
  ) {
    this.configured = Boolean(secretKey && publicBaseUrl && price && price > 0);
    const liveKey = Boolean(secretKey?.startsWith("live_"));
    this.enabled = this.configured && (!liveKey || webhookReady);
    this.checkoutMode = !this.enabled
      ? "disabled"
      : liveKey ? "live" : "test";
  }

  status(identity: BillingIdentity): BillingStatus {
    const entitlement = this.store.entitlement(identity.tenantId);
    const effectivePlan = entitlement.active || identity.basePlan === "pro"
      ? "pro"
      : identity.basePlan;
    return {
      enabled: this.enabled,
      provider: "toss-payments",
      effectivePlan,
      proUntil: entitlement.proUntil,
      price: this.configured ? this.price : null,
      proDays: this.proDays,
      checkoutMode: this.checkoutMode,
      webhookReady: this.webhookReady,
      freeProductLimit: this.freeProductLimit,
      freeMarketLimit: this.freeMarketLimit
    };
  }

  async createCheckout(identity: BillingIdentity): Promise<{ orderId: string; checkoutUrl: string; amount: number; mode: "test" | "live" }> {
    this.assertEnabled();
    const orderId = `SH_${Date.now()}_${randomBytes(8).toString("hex")}`;
    const amount = this.price!;
    await this.store.createOrder({ orderId, tenantId: identity.tenantId, userId: identity.userId, amount, proDays: this.proDays });

    try {
      const body = await this.request("https://api.tosspayments.com/v1/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": orderId },
        body: JSON.stringify({
          method: "CARD",
          amount,
          orderId,
          orderName: `SellerHub PRO ${this.proDays}일`,
          successUrl: `${this.publicBaseUrl}/billing/success`,
          failUrl: `${this.publicBaseUrl}/billing/fail`,
          flowMode: "DEFAULT"
        })
      });
      const parsed = createPaymentSchema.parse(body);
      if (parsed.orderId !== orderId) throw new Error("토스페이먼츠 주문번호가 일치하지 않습니다.");
      return { orderId, checkoutUrl: parsed.checkout.url, amount, mode: this.checkoutMode as "test" | "live" };
    } catch (error) {
      await this.store.failOrder(orderId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async confirm(identity: BillingIdentity, input: { paymentKey: string; orderId: string; amount: number }): Promise<BillingStatus> {
    this.assertEnabled();
    const order = this.store.getOrder(input.orderId);
    if (!order) throw new Error("SellerHub 결제 주문을 찾을 수 없습니다.");
    if (order.tenantId !== identity.tenantId || order.userId !== identity.userId) throw new Error("다른 계정의 결제 주문입니다.");
    if (order.amount !== input.amount) throw new Error("결제 금액이 SellerHub 주문금액과 일치하지 않습니다.");

    if (order.status === "DONE") {
      if (order.paymentKey !== input.paymentKey) throw new Error("이미 다른 결제로 완료된 주문입니다.");
      return this.status(identity);
    }

    const body = await this.request("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `confirm-${input.orderId}` },
      body: JSON.stringify({ paymentKey: input.paymentKey, orderId: input.orderId, amount: input.amount })
    });
    const parsed = paymentSchema.parse(body);
    this.assertPaymentMatches(parsed, input.orderId, input.paymentKey, input.amount);
    if (parsed.status !== "DONE") throw new Error(`결제가 완료 상태가 아닙니다: ${parsed.status}`);

    await this.store.completeOrder({ orderId: input.orderId, paymentKey: input.paymentKey, amount: input.amount });
    return this.status(identity);
  }

  async handleWebhook(payload: unknown): Promise<{ handled: boolean; status?: string; orderId?: string }> {
    if (!this.secretKey) throw new Error("토스페이먼츠 비밀키가 설정되지 않았습니다.");
    const event = webhookSchema.parse(payload);
    if (event.eventType !== "PAYMENT_STATUS_CHANGED") return { handled: false };

    const paymentKey = text(event.data.paymentKey);
    const orderId = text(event.data.orderId);
    if (!paymentKey || !orderId) throw new Error("토스페이먼츠 웹훅에 paymentKey/orderId가 없습니다.");
    const order = this.store.getOrder(orderId);
    if (!order) return { handled: false, orderId };

    // General payment webhooks do not carry a verifiable signature. Re-query Toss Payments
    // with our secret key and trust only the server-to-server Payment response.
    const verified = paymentSchema.parse(await this.request(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
      method: "GET"
    }));
    this.assertPaymentMatches(verified, orderId, paymentKey, order.amount);

    if (verified.status === "DONE") {
      await this.store.completeOrder({ orderId, paymentKey, amount: order.amount });
    } else if (verified.status === "CANCELED" || verified.status === "PARTIAL_CANCELED") {
      await this.store.cancelOrder(orderId, paymentKey, `Toss webhook status: ${verified.status}`);
    }
    return { handled: true, status: verified.status, orderId };
  }

  private assertPaymentMatches(payment: z.infer<typeof paymentSchema>, orderId: string, paymentKey: string, amount: number) {
    if (payment.orderId !== orderId || payment.paymentKey !== paymentKey || payment.totalAmount !== amount) {
      throw new Error("토스페이먼츠 결제정보가 SellerHub 주문정보와 일치하지 않습니다.");
    }
  }

  private assertEnabled() {
    if (!this.enabled) {
      if (this.secretKey?.startsWith("live_") && !this.webhookReady) {
        throw new Error("실결제는 PAYMENT_STATUS_CHANGED 웹훅을 등록하고 TOSS_PAYMENTS_WEBHOOK_ENABLED=true로 설정한 뒤 활성화할 수 있습니다.");
      }
      throw new Error("결제 기능이 아직 설정되지 않았습니다. TOSS_PAYMENTS_SECRET_KEY, PUBLIC_BASE_URL, BILLING_PRO_30D_PRICE를 설정해 주세요.");
    }
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const authorization = `Basic ${Buffer.from(`${this.secretKey}:`, "utf8").toString("base64")}`;
      const response = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: authorization, Accept: "application/json", ...init.headers },
        signal: controller.signal
      });
      const responseText = await response.text();
      const body = responseText ? safeJson(responseText) : {};
      if (!response.ok) throw new Error(`토스페이먼츠 HTTP ${response.status}: ${messageOf(body)}`);
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("토스페이먼츠 요청 시간이 초과되었습니다.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return { message: value.slice(0, 500) }; }
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== "object") return "request failed";
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.code === "string") return record.code;
  return "request failed";
}
