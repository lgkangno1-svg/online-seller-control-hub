import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { z } from "zod";
import type { CodexCommandInterpreter } from "../ai/codexInterpreter.js";
import type { TossPaymentsBillingService } from "../billing/tossPaymentsBilling.js";
import type { CatalogProduct, ProductCatalog } from "../catalog/catalog.js";
import type { ApprovalStore } from "../core/approvalStore.js";
import type { ControlService } from "../core/controlService.js";
import { MARKETS, type Market } from "../core/types.js";
import type { MarketConnectionService } from "../markets/marketConnectionService.js";
import { verifyNaverSolutionSellerJwt, NaverSolutionJwtError } from "../markets/naverSolutionJwt.js";
import { REFERENCE_KINDS, type MarketReferenceService } from "../markets/marketReferenceService.js";
import { validateRegistrationPayload } from "../markets/registrationValidator.js";
import type { AuditLog } from "../persistence/auditLog.js";
import { CredentialStoreNotReadyError, type EncryptedCredentialStore } from "../persistence/credentialStore.js";
import type { FeedbackStore } from "../persistence/feedbackStore.js";
import {
  MarketplaceAccountAlreadyLinkedError,
  MarketplaceLinkStoreNotReadyError,
  MarketplaceRelinkRequiredError,
  type MarketplaceLinkStore
} from "../persistence/marketLinkStore.js";
import type { RegistrationLedger } from "../persistence/registrationLedger.js";
import { AuthRateLimitError } from "./authAbuseGuard.js";
import { safeInternalError } from "./internalError.js";
import { serveWebAsset } from "./staticFiles.js";
import type { WebAuth, WebIdentity } from "./webAuth.js";

const previewSchema = z.object({ text: z.string().trim().min(1).max(500) });
const feedbackSchema = z.object({
  score: z.number().int().min(1).max(5),
  message: z.string().trim().min(1).max(4000),
  page: z.string().trim().min(1).max(200).default("dashboard")
});
const loginSchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128)
});
const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
  inviteCode: z.string().max(200).optional()
});
const registrationPayloadSchema = z.object({ payload: z.record(z.unknown()) });
const registrationSchema = registrationPayloadSchema.extend({
  confirmed: z.literal(true),
  masterSku: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().trim().min(8).max(200)
});
const billingConfirmSchema = z.object({
  paymentKey: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
  amount: z.number().int().positive()
});
const naverSolutionLinkSchema = z.object({ token: z.string().trim().min(1).max(16 * 1024) });
const marketSchema = z.enum(MARKETS);
const referenceKindSchema = z.enum(REFERENCE_KINDS);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function createWebServer(deps: {
  auth: WebAuth;
  billing: TossPaymentsBillingService;
  interpreter: CodexCommandInterpreter;
  catalog: ProductCatalog;
  approvals: ApprovalStore;
  control: ControlService;
  audit: AuditLog;
  feedback: FeedbackStore;
  credentials: EncryptedCredentialStore;
  marketLinks?: MarketplaceLinkStore;
  naverSolution?: { solutionId: string; publicKeyPem: string } | null;
  registrationLedger: RegistrationLedger;
  marketConnections: MarketConnectionService;
  marketReferences: MarketReferenceService;
  dryRun: boolean;
  productRegistrationEnabled: boolean;
  webDistPath?: string;
  publicEgressIp: string | null;
  trustCloudflareHeaders?: boolean;
}) {
  return createServer(async (req, res) => {
    setSecurityHeaders(res);

    try {
      if (deps.webDistPath && !req.url?.startsWith("/api")) {
        const served = await serveWebAsset(req, res, deps.webDistPath);
        if (served) return;
      }

      if (req.method === "GET" && req.url === "/api/health") {
        return json(res, 200, {
          ok: true,
          dryRun: deps.dryRun,
          productRegistrationEnabled: deps.productRegistrationEnabled
        });
      }

      if (req.method === "GET" && req.url === "/api/auth/config") {
        return json(res, 200, { signupAvailable: deps.auth.signupAvailable(), signupMode: "approval" });
      }

      if (req.method === "POST" && req.url === "/api/auth/login") {
        const body = loginSchema.parse(await readJson(req));
        const sourceKey = authSourceKey(req, deps.trustCloudflareHeaders === true);
        try {
          const result = await deps.auth.login(body.email, body.password, sourceKey);
          return json(res, 200, result);
        } catch (error) {
          if (error instanceof AuthRateLimitError) return rateLimited(res, error);
          return json(res, 401, { error: "invalid_credentials", message: publicMessage(error) });
        }
      }

      if (req.method === "POST" && req.url === "/api/auth/register") {
        const body = registerSchema.parse(await readJson(req));
        const sourceKey = authSourceKey(req, deps.trustCloudflareHeaders === true);
        try {
          const result = await deps.auth.requestSignup({ email: body.email, password: body.password }, sourceKey);
          return json(res, 202, result);
        } catch (error) {
          if (error instanceof AuthRateLimitError) return rateLimited(res, error);
          return json(res, 409, { error: "registration_failed", message: publicMessage(error) });
        }
      }

      if (req.method === "POST" && req.url === "/api/auth/logout") {
        const loggedOut = await deps.auth.logout(req.headers.authorization);
        return json(res, 200, { loggedOut });
      }

      if (req.method === "POST" && req.url === "/api/webhooks/toss-payments") {
        const result = await deps.billing.handleWebhook(await readJson(req));
        return json(res, 200, result);
      }

      const identity = deps.auth.authenticate(req.headers.authorization);
      if (!identity) return json(res, 401, { error: "unauthorized" });
      const actor = { kind: "web" as const, id: `${identity.tenantId}:${identity.userId}` };
      const billingIdentity = toBillingIdentity(identity);
      const billing = deps.billing.status(billingIdentity);

      if (req.method === "GET" && req.url === "/api/account") {
        return json(res, 200, {
          userId: identity.userId,
          tenantId: identity.tenantId,
          email: identity.email,
          username: identity.username,
          role: identity.role,
          authKind: identity.authKind,
          plan: billing.effectivePlan,
          basePlan: identity.plan,
          beta: billing.effectivePlan === "beta",
          billingEnabled: billing.enabled,
          proUntil: billing.proUntil,
          checkoutMode: billing.checkoutMode,
          webhookReady: billing.webhookReady,
          limits: {
            freeProductLimit: billing.freeProductLimit,
            freeMarketLimit: billing.freeMarketLimit
          }
        });
      }

      if (req.method === "GET" && req.url === "/api/admin/signup-requests") {
        if (identity.role !== "admin") return json(res, 403, { error: "admin_required" });
        return json(res, 200, { requests: deps.auth.signupRequests() });
      }

      const signupActionMatch = req.method === "POST"
        ? req.url?.match(/^\/api\/admin\/signup-requests\/([^/]+)\/(approve|reject)$/)
        : null;
      if (signupActionMatch) {
        if (identity.role !== "admin") return json(res, 403, { error: "admin_required" });
        const userId = decodeURIComponent(signupActionMatch[1]!);
        const action = signupActionMatch[2]!;
        try {
          const request = action === "approve"
            ? await deps.auth.approveSignup(userId)
            : await deps.auth.rejectSignup(userId);
          return json(res, 200, { request });
        } catch (error) {
          return json(res, 409, { error: "signup_request_action_failed", message: publicMessage(error) });
        }
      }

      if (req.method === "GET" && req.url === "/api/billing/status") {
        return json(res, 200, billing);
      }

      if (req.method === "POST" && req.url === "/api/billing/checkout") {
        if (!billing.enabled) return json(res, 409, { error: "billing_not_configured" });
        const checkout = await deps.billing.createCheckout(billingIdentity);
        return json(res, 201, checkout);
      }

      if (req.method === "POST" && req.url === "/api/billing/confirm") {
        if (!billing.enabled) return json(res, 409, { error: "billing_not_configured" });
        const input = billingConfirmSchema.parse(await readJson(req));
        const status = await deps.billing.confirm(billingIdentity, input);
        return json(res, 200, status);
      }

      if (req.method === "GET" && req.url?.startsWith("/api/activity")) {
        const parsedUrl = new URL(req.url, "http://sellerhub.local");
        if (parsedUrl.pathname === "/api/activity") {
          const rawLimit = Number(parsedUrl.searchParams.get("limit") ?? "100");
          const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 100;
          return json(res, 200, { entries: await deps.audit.list(identity.tenantId, limit) });
        }
      }

      if (req.method === "GET" && req.url === "/api/catalog") {
        return json(res, 200, { products: catalogResponse(deps.catalog, identity.tenantId) });
      }

      if (req.method === "POST" && req.url === "/api/catalog") {
        const input = await readJson(req);
        const sku = z.object({ masterSku: z.string().trim().min(1).max(120) }).passthrough().parse(input).masterSku;
        const products = deps.catalog.list(identity.tenantId);
        const alreadyExists = products.some((item) => item.masterSku.toLowerCase() === sku.toLowerCase());
        if (billing.effectivePlan === "free" && !alreadyExists && products.length >= billing.freeProductLimit) {
          return planLimit(res, "free_product_limit", `FREE 플랜은 Master SKU ${billing.freeProductLimit}개까지 등록할 수 있습니다.`, billing);
        }
        const product = await deps.catalog.upsert(identity.tenantId, input);
        return json(res, 200, { product: serializeProduct(product) });
      }

      const catalogDeleteMatch = req.method === "DELETE" ? req.url?.match(/^\/api\/catalog\/([^/?]+)$/) : null;
      if (catalogDeleteMatch) {
        const deleted = await deps.catalog.remove(identity.tenantId, decodeURIComponent(catalogDeleteMatch[1]!));
        return json(res, deleted ? 200 : 404, { deleted });
      }

      if (req.method === "GET" && req.url === "/api/markets/connections") {
        return json(res, 200, {
          storageReady: deps.credentials.ready,
          publicEgressIp: deps.publicEgressIp,
          connections: deps.credentials.statuses(identity.tenantId),
          delegatedLinks: deps.marketLinks?.ready ? deps.marketLinks.statuses(identity.tenantId) : [],
          naverSolutionReady: Boolean(deps.naverSolution && deps.marketLinks?.ready)
        });
      }

      if (req.method === "POST" && req.url === "/api/markets/naver/solution-link") {
        if (!deps.naverSolution) {
          return json(res, 503, { error: "naver_solution_not_configured", message: "네이버 커머스솔루션 운영 설정이 아직 완료되지 않았습니다." });
        }
        if (!deps.marketLinks?.ready) {
          return json(res, 503, { error: "market_link_storage_not_configured", message: "마켓 위임연동 암호화 저장소가 준비되지 않았습니다." });
        }

        const alreadyLinked = deps.marketLinks.statuses(identity.tenantId).find((item) => item.market === "naver")?.linked ?? false;
        if (!alreadyLinked && billing.effectivePlan === "free") {
          const connected = connectedMarketCount(deps, identity.tenantId);
          if (connected >= billing.freeMarketLimit) {
            return planLimit(res, "free_market_limit", `FREE 플랜은 마켓 ${billing.freeMarketLimit}개까지 연결할 수 있습니다.`, billing);
          }
        }

        const body = naverSolutionLinkSchema.parse(await readJson(req));
        try {
          const seller = verifyNaverSolutionSellerJwt({
            token: body.token,
            solutionId: deps.naverSolution.solutionId,
            publicKeyPem: deps.naverSolution.publicKeyPem
          });
          await deps.marketLinks.set(identity.tenantId, "naver", seller.accountUid, "naver_solution_jwt");
          return json(res, 200, { market: "naver", linked: true, expiresAt: seller.expiresAt });
        } catch (error) {
          if (error instanceof NaverSolutionJwtError) {
            return json(res, 422, { error: "invalid_naver_solution_token", message: error.message });
          }
          if (error instanceof MarketplaceAccountAlreadyLinkedError) {
            return json(res, 409, { error: "market_account_already_linked", message: "이 네이버 판매자 계정은 이미 다른 SellerHub 계정에 연결되어 있습니다." });
          }
          if (error instanceof MarketplaceRelinkRequiredError) {
            return json(res, 409, { error: "market_relink_requires_unlink", message: "기존 네이버 스토어 연결을 먼저 해제한 뒤 다른 스토어를 연결해 주세요." });
          }
          throw error;
        }
      }

      if (req.method === "DELETE" && req.url === "/api/markets/naver/solution-link") {
        if (!deps.marketLinks?.ready) {
          return json(res, 503, { error: "market_link_storage_not_configured" });
        }
        const removed = await deps.marketLinks.remove(identity.tenantId, "naver");
        return json(res, removed ? 200 : 404, { market: "naver", linked: false, removed });
      }

      const marketConnectionMatch = req.url?.match(/^\/api\/markets\/connections\/([^/?]+)$/);
      if (marketConnectionMatch && (req.method === "PUT" || req.method === "DELETE")) {
        const market = marketSchema.parse(decodeURIComponent(marketConnectionMatch[1]!));
        if (req.method === "PUT") {
          if (market === "naver" && identity.role !== "admin") {
            return json(res, 403, {
              error: "delegated_onboarding_required",
              message: "일반 이용자는 네이버 API 키를 등록하지 않습니다. 네이버 커머스솔루션 연결을 사용해 주세요."
            });
          }
          const statuses = deps.credentials.statuses(identity.tenantId);
          const current = statuses.find((item) => item.market === market)?.configured ?? false;
          const configuredCount = connectedMarketCount(deps, identity.tenantId);
          if (billing.effectivePlan === "free" && !current && configuredCount >= billing.freeMarketLimit) {
            return planLimit(res, "free_market_limit", `FREE 플랜은 마켓 ${billing.freeMarketLimit}개까지 연결할 수 있습니다.`, billing);
          }
          await deps.credentials.set(identity.tenantId, market, await readJson(req));
          return json(res, 200, { market, configured: true });
        }
        const removed = await deps.credentials.remove(identity.tenantId, market);
        return json(res, removed ? 200 : 404, { market, configured: false, removed });
      }

      const verifyConnectionMatch = req.method === "POST"
        ? req.url?.match(/^\/api\/markets\/connections\/([^/?]+)\/verify$/)
        : null;
      if (verifyConnectionMatch) {
        const market = marketSchema.parse(decodeURIComponent(verifyConnectionMatch[1]!));
        const result = await deps.marketConnections.verify(identity.tenantId, market);
        return json(res, result.ok ? 200 : 422, result);
      }

      if (req.method === "GET" && req.url?.startsWith("/api/markets/")) {
        const parsedUrl = new URL(req.url, "http://sellerhub.local");
        const referenceMatch = parsedUrl.pathname.match(/^\/api\/markets\/([^/]+)\/references\/([^/]+)$/);
        if (referenceMatch) {
          const market = marketSchema.parse(decodeURIComponent(referenceMatch[1]!));
          const kind = referenceKindSchema.parse(decodeURIComponent(referenceMatch[2]!));
          const categoryId = parsedUrl.searchParams.get("categoryId")?.trim() || undefined;
          const keyword = parsedUrl.searchParams.get("keyword")?.trim() || undefined;
          const data = await deps.marketReferences.get(identity.tenantId, market, kind, {
            ...(categoryId ? { categoryId } : {}),
            ...(keyword ? { keyword } : {})
          });
          return json(res, 200, { market, kind, data });
        }
      }

      const validateProductMatch = req.method === "POST"
        ? req.url?.match(/^\/api\/markets\/([^/?]+)\/products\/validate$/)
        : null;
      if (validateProductMatch) {
        const market = marketSchema.parse(decodeURIComponent(validateProductMatch[1]!));
        const body = registrationPayloadSchema.parse(await readJson(req));
        const validation = validateRegistrationPayload(market, body.payload);
        return json(res, validation.ok ? 200 : 422, validation);
      }

      const registerProductMatch = req.method === "POST"
        ? req.url?.match(/^\/api\/markets\/([^/?]+)\/products$/)
        : null;
      if (registerProductMatch) {
        if (!deps.productRegistrationEnabled) return json(res, 409, { error: "product_registration_disabled" });
        const market = marketSchema.parse(decodeURIComponent(registerProductMatch[1]!));
        const body = registrationSchema.parse(await readJson(req));
        const validation = validateRegistrationPayload(market, body.payload);
        if (!validation.ok) return json(res, 422, { error: "registration_preflight_failed", validation });

        const product = deps.catalog.list(identity.tenantId).find((item) => item.masterSku.toLowerCase() === body.masterSku.toLowerCase());
        if (!product) return json(res, 404, { error: "master_sku_not_found" });
        if (product.markets[market]?.productId) {
          return json(res, 409, { error: "market_product_already_mapped", productId: product.markets[market]?.productId });
        }

        const claim = await deps.registrationLedger.claim({
          tenantId: identity.tenantId,
          market,
          idempotencyKey: body.idempotencyKey,
          masterSku: body.masterSku,
          payload: body.payload
        });
        if (claim.kind === "conflict") return json(res, 409, { error: "duplicate_registration_conflict", message: claim.reason });
        if (claim.kind === "cached") return json(res, 200, { ...claim.result, cached: true });

        const verification = await deps.marketConnections.verify(identity.tenantId, market);
        if (!verification.ok) {
          const failed = { market, ok: false, message: verification.message, externalId: null, controlExternalId: null };
          await deps.registrationLedger.finish({ tenantId: identity.tenantId, market, idempotencyKey: body.idempotencyKey, result: failed });
          return json(res, 422, { error: "market_connection_verification_failed", verification });
        }
        if (!verification.registrationSupported) {
          const failed = { market, ok: false, message: "상품 등록이 활성화되지 않은 마켓입니다.", externalId: null, controlExternalId: null };
          await deps.registrationLedger.finish({ tenantId: identity.tenantId, market, idempotencyKey: body.idempotencyKey, result: failed });
          return json(res, 409, { error: "product_registration_not_enabled_for_market", verification });
        }

        const result = await deps.marketConnections.registerProduct(identity.tenantId, market, body.payload);
        if (result.ok && result.externalId) {
          await deps.catalog.setMarketplaceMapping(identity.tenantId, body.masterSku, market, {
            productId: result.externalId,
            ...(result.controlExternalId ? { externalId: result.controlExternalId } : controlUsesProductId(market) ? { externalId: result.externalId } : {})
          });
        }
        await deps.registrationLedger.finish({ tenantId: identity.tenantId, market, idempotencyKey: body.idempotencyKey, result });
        await deps.audit.recordRegistration({ actor, masterSku: body.masterSku, market, payload: body.payload, result });
        return json(res, result.ok ? 201 : 422, { ...result, validation });
      }

      if (req.method === "POST" && req.url === "/api/feedback") {
        const body = feedbackSchema.parse(await readJson(req));
        await deps.feedback.record({
          userId: identity.userId,
          tenantId: identity.tenantId,
          score: body.score,
          message: body.message,
          page: body.page,
          userAgent: req.headers["user-agent"] ?? null
        });
        return json(res, 201, { saved: true });
      }

      if (req.method === "POST" && req.url === "/api/commands/preview") {
        const body = previewSchema.parse(await readJson(req));
        const command = await deps.interpreter.parse(body.text);
        const resolved = deps.catalog.resolve(command.productQuery, identity.tenantId);

        if (resolved.kind === "missing") return json(res, 404, { error: "product_not_found", productQuery: command.productQuery });
        if (resolved.kind === "ambiguous") {
          return json(res, 409, {
            error: "product_ambiguous",
            candidates: resolved.products.map((product) => ({ name: product.name, masterSku: product.masterSku }))
          });
        }

        const mappedMarkets = command.markets.filter((market) => Boolean(resolved.product.markets[market]?.externalId));
        if (mappedMarkets.length !== command.markets.length) {
          const missingMarkets = command.markets.filter((market) => !resolved.product.markets[market]?.externalId);
          return json(res, 409, { error: "market_control_mapping_missing", markets: missingMarkets });
        }

        const snapshot = await deps.control.snapshot(resolved.product, command);
        const approval = deps.approvals.create({ actor, command, product: resolved.product, snapshot });
        return json(res, 200, {
          approvalId: approval.id,
          expiresAt: new Date(approval.expiresAt).toISOString(),
          product: { name: resolved.product.name, masterSku: resolved.product.masterSku },
          command,
          snapshot
        });
      }

      const approveMatch = req.method === "POST" ? req.url?.match(/^\/api\/commands\/([^/]+)\/approve$/) : null;
      if (approveMatch) {
        const approval = deps.approvals.consume(decodeURIComponent(approveMatch[1]!), actor);
        if (!approval) return json(res, 410, { error: "approval_expired_or_consumed" });
        const results = await deps.control.execute(approval.product, approval.command);
        await deps.audit.record({ actor, masterSku: approval.product.masterSku, command: approval.command, results });
        return json(res, 200, { results });
      }

      const cancelMatch = req.method === "POST" ? req.url?.match(/^\/api\/commands\/([^/]+)\/cancel$/) : null;
      if (cancelMatch) {
        const cancelled = deps.approvals.cancel(decodeURIComponent(cancelMatch[1]!), actor);
        return json(res, cancelled ? 200 : 410, { cancelled });
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof CredentialStoreNotReadyError) return json(res, 503, { error: "credential_storage_not_configured" });
      if (error instanceof MarketplaceLinkStoreNotReadyError) return json(res, 503, { error: "market_link_storage_not_configured" });
      if (error instanceof z.ZodError) return json(res, 400, { error: "invalid_request", issues: error.issues.map((issue) => issue.message) });
      if (error instanceof SyntaxError) return json(res, 400, { error: "invalid_json" });
      const safe = safeInternalError(error);
      console.error("web api error", safe.log);
      return json(res, 500, safe.body);
    }
  });
}

function toBillingIdentity(identity: WebIdentity) {
  return { userId: identity.userId, tenantId: identity.tenantId, basePlan: identity.plan } as const;
}

function connectedMarketCount(deps: {
  credentials: EncryptedCredentialStore;
  marketLinks?: MarketplaceLinkStore;
}, tenantId: string): number {
  const markets = new Set<Market>();
  for (const status of deps.credentials.statuses(tenantId)) {
    if (status.configured) markets.add(status.market);
  }
  if (deps.marketLinks?.ready) {
    for (const status of deps.marketLinks.statuses(tenantId)) {
      if (status.linked) markets.add(status.market);
    }
  }
  return markets.size;
}

function planLimit(
  res: ServerResponse,
  code: string,
  message: string,
  billing: ReturnType<TossPaymentsBillingService["status"]>
) {
  return json(res, 403, {
    error: "plan_limit_exceeded",
    code,
    message,
    upgrade: { enabled: billing.enabled, price: billing.price, proDays: billing.proDays }
  });
}

function catalogResponse(catalog: ProductCatalog, tenantId: string) {
  return catalog.list(tenantId).map(serializeProduct);
}

function serializeProduct(product: CatalogProduct) {
  return {
    masterSku: product.masterSku,
    name: product.name,
    aliases: product.aliases,
    markets: Object.keys(product.markets),
    marketMappings: Object.fromEntries(
      Object.entries(product.markets)
        .filter(([, mapping]) => Boolean(mapping?.externalId))
        .map(([market, mapping]) => [market, mapping!.externalId])
    ),
    marketProductIds: Object.fromEntries(
      Object.entries(product.markets)
        .filter(([, mapping]) => Boolean(mapping?.productId))
        .map(([market, mapping]) => [market, mapping!.productId])
    )
  };
}

function controlUsesProductId(market: Market): boolean {
  return market === "naver" || market === "gmarket" || market === "lotteon" || market === "kakao";
}

function authSourceKey(req: IncomingMessage, trustCloudflareHeaders: boolean): string {
  if (trustCloudflareHeaders) {
    const cloudflareIp = singleHeader(req.headers["cf-connecting-ip"]);
    if (cloudflareIp && isIP(cloudflareIp)) return `cf:${cloudflareIp}`;
  }
  const remoteAddress = req.socket.remoteAddress?.trim();
  if (remoteAddress && isIP(remoteAddress)) return `peer:${remoteAddress}`;
  return "peer:unknown";
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(",")) return null;
  return trimmed;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
}

function publicMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rateLimited(res: ServerResponse, error: AuthRateLimitError) {
  res.setHeader("Retry-After", String(error.retryAfterSeconds));
  return json(res, 429, { error: "rate_limited", message: error.message, retryAfterSeconds: error.retryAfterSeconds });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
