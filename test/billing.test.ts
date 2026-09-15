import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TossPaymentsBillingService } from "../src/billing/tossPaymentsBilling.js";
import { BillingStore } from "../src/persistence/billingStore.js";

async function setup(fetchImpl: typeof fetch, options: { secret?: string; webhookReady?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "sellerhub-billing-"));
  const store = await BillingStore.load(join(dir, "billing.json"));
  const service = new TossPaymentsBillingService(
    store,
    options.secret ?? "test_sk_sellerhub",
    "https://sellerhub.test",
    29_000,
    30,
    20,
    2,
    fetchImpl,
    options.webhookReady ?? false
  );
  return { store, service };
}

test("billing checkout stores server amount and confirmation activates PRO", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(init ? { url, init } : { url });
    if (url.endsWith("/v1/payments")) {
      const request = JSON.parse(String(init?.body)) as { orderId: string; amount: number; successUrl: string };
      assert.equal(request.amount, 29_000);
      assert.equal(request.successUrl, "https://sellerhub.test/billing/success");
      return json({ orderId: request.orderId, status: "READY", checkout: { url: "https://checkout.test/pay" } });
    }
    if (url.endsWith("/v1/payments/confirm")) {
      const request = JSON.parse(String(init?.body)) as { paymentKey: string; orderId: string; amount: number };
      return json({ paymentKey: request.paymentKey, orderId: request.orderId, totalAmount: request.amount, status: "DONE" });
    }
    return json({ message: "not found" }, 404);
  }) as typeof fetch;

  const { service } = await setup(fetchMock);
  const identity = { userId: "tester", tenantId: "tenant-a", basePlan: "beta" as const };
  const checkout = await service.createCheckout(identity);
  assert.equal(checkout.amount, 29_000);
  assert.equal(checkout.mode, "test");
  assert.equal(checkout.checkoutUrl, "https://checkout.test/pay");

  const status = await service.confirm(identity, { paymentKey: "pay_123", orderId: checkout.orderId, amount: 29_000 });
  assert.equal(status.effectivePlan, "pro");
  assert.ok(status.proUntil);
  assert.match(String((calls[0]!.init?.headers as Record<string, string>).Authorization), /^Basic /);
});

test("billing rejects browser amount tampering before calling payment confirm", async () => {
  let confirms = 0;
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/payments")) {
      const request = JSON.parse(String(init?.body)) as { orderId: string };
      return json({ orderId: request.orderId, status: "READY", checkout: { url: "https://checkout.test/pay" } });
    }
    confirms += 1;
    return json({});
  }) as typeof fetch;

  const { service } = await setup(fetchMock);
  const identity = { userId: "tester", tenantId: "tenant-a", basePlan: "free" as const };
  const checkout = await service.createCheckout(identity);
  await assert.rejects(
    () => service.confirm(identity, { paymentKey: "pay_123", orderId: checkout.orderId, amount: 100 }),
    /주문금액과 일치하지 않습니다/
  );
  assert.equal(confirms, 0);
});

test("billing order cannot be confirmed by another tenant", async () => {
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { orderId?: string };
    return json({ orderId: request.orderId, status: "READY", checkout: { url: "https://checkout.test/pay" } });
  }) as typeof fetch;
  const { service } = await setup(fetchMock);
  const owner = { userId: "owner", tenantId: "tenant-a", basePlan: "free" as const };
  const attacker = { userId: "attacker", tenantId: "tenant-b", basePlan: "free" as const };
  const checkout = await service.createCheckout(owner);
  await assert.rejects(
    () => service.confirm(attacker, { paymentKey: "pay_1", orderId: checkout.orderId, amount: 29_000 }),
    /다른 계정의 결제 주문/
  );
});

test("live checkout remains disabled until hosted-payment webhook is registered", async () => {
  const fetchMock = (async () => json({})) as typeof fetch;
  const { service } = await setup(fetchMock, { secret: "live_sk_sellerhub", webhookReady: false });
  const status = service.status({ userId: "owner", tenantId: "tenant-a", basePlan: "free" });
  assert.equal(status.enabled, false);
  assert.equal(status.checkoutMode, "disabled");
  assert.equal(status.webhookReady, false);
  await assert.rejects(
    () => service.createCheckout({ userId: "owner", tenantId: "tenant-a", basePlan: "free" }),
    /PAYMENT_STATUS_CHANGED 웹훅/
  );
});

test("payment webhook is re-queried from Toss before cancellation revokes PRO", async () => {
  let orderId = "";
  let paymentStatus = "DONE";
  const calls: string[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/payments")) {
      const request = JSON.parse(String(init?.body)) as { orderId: string };
      orderId = request.orderId;
      return json({ orderId, status: "READY", checkout: { url: "https://checkout.test/pay" } });
    }
    if (url.endsWith("/v1/payments/confirm")) {
      return json({ paymentKey: "pay_verified", orderId, totalAmount: 29_000, status: "DONE" });
    }
    if (url.endsWith("/v1/payments/pay_verified")) {
      return json({ paymentKey: "pay_verified", orderId, totalAmount: 29_000, status: paymentStatus });
    }
    return json({ message: "not found" }, 404);
  }) as typeof fetch;

  const { service } = await setup(fetchMock);
  const identity = { userId: "owner", tenantId: "tenant-a", basePlan: "free" as const };
  const checkout = await service.createCheckout(identity);
  await service.confirm(identity, { paymentKey: "pay_verified", orderId: checkout.orderId, amount: 29_000 });
  assert.equal(service.status(identity).effectivePlan, "pro");

  paymentStatus = "CANCELED";
  const result = await service.handleWebhook({
    eventType: "PAYMENT_STATUS_CHANGED",
    createdAt: new Date().toISOString(),
    data: {
      paymentKey: "pay_verified",
      orderId,
      totalAmount: 1,
      status: "DONE"
    }
  });
  assert.equal(result.handled, true);
  assert.equal(result.status, "CANCELED");
  assert.equal(service.status(identity).effectivePlan, "free");
  assert.ok(calls.some((url) => url.endsWith("/v1/payments/pay_verified")), "webhook must be verified by Payment query API");
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
