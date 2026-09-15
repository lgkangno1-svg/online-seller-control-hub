import "dotenv/config";
import { resolve } from "node:path";
import { CodexCommandInterpreter } from "./ai/codexInterpreter.js";
import { TossPaymentsBillingService } from "./billing/tossPaymentsBilling.js";
import { createTelegramBot } from "./bot/telegramBot.js";
import { ProductCatalog } from "./catalog/catalog.js";
import { ApprovalStore } from "./core/approvalStore.js";
import { ControlService } from "./core/controlService.js";
import { MARKETS, type Market } from "./core/types.js";
import { PersistingMarketReferenceService } from "./markets/persistingMarketReferenceService.js";
import { buildMarketRegistry } from "./markets/registry.js";
import { SellerHubMarketConnectionService } from "./markets/sellerHubMarketConnectionService.js";
import { AccountStore } from "./persistence/accountStore.js";
import { AuditLog } from "./persistence/auditLog.js";
import { BillingStore } from "./persistence/billingStore.js";
import { EncryptedCredentialStore } from "./persistence/credentialStore.js";
import { FeedbackStore } from "./persistence/feedbackStore.js";
import { MarketplaceLinkStore } from "./persistence/marketLinkStore.js";
import { OrderSnapshotStore } from "./persistence/orderSnapshotStore.js";
import { RegistrationLedger } from "./persistence/registrationLedger.js";
import { SecurityAuditLog } from "./persistence/securityAuditLog.js";
import { AuthAbuseGuard } from "./web/authAbuseGuard.js";
import { createWebServer } from "./web/httpServer.js";
import { WebAuth } from "./web/webAuth.js";

const dryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const productRegistrationEnabled = envBool("PRODUCT_REGISTRATION_ENABLED", false);
const ttlSeconds = Number(process.env.APPROVAL_TTL_SECONDS ?? "600");
const approvalStorePath = resolve(process.env.APPROVAL_STORE_PATH ?? "./data/approvals.json");
const catalogPath = resolve(process.env.PRODUCT_CATALOG_PATH ?? "./data/products.json");
const auditPath = resolve(process.env.AUDIT_LOG_PATH ?? "./data/audit.jsonl");
const securityAuditPath = resolve(process.env.SECURITY_AUDIT_LOG_PATH ?? "./data/security-audit.jsonl");
const authAbuseStatePath = resolve(process.env.AUTH_ABUSE_STATE_PATH ?? "./data/auth-abuse-state.json");
const feedbackPath = resolve(process.env.FEEDBACK_LOG_PATH ?? "./data/feedback.jsonl");
const credentialPath = resolve(process.env.MARKET_CREDENTIALS_PATH ?? "./data/market-credentials.enc.json");
const marketLinksPath = resolve(process.env.MARKET_LINKS_PATH ?? "./data/market-links.enc.json");
const registrationLedgerPath = resolve(process.env.REGISTRATION_LEDGER_PATH ?? "./data/registration-ledger.json");
const orderSnapshotPath = resolve(process.env.ORDER_SNAPSHOT_PATH ?? "./data/order-snapshots.json");
const billingStorePath = resolve(process.env.BILLING_STORE_PATH ?? "./data/billing.json");
const accountStorePath = resolve(process.env.ACCOUNT_STORE_PATH ?? "./data/accounts.json");
const codexWorkdir = resolve(process.env.CODEX_WORKDIR ?? ".");
const webDistPath = resolve(process.env.WEB_DIST_PATH ?? "./web/dist");
const webEnabled = envBool("WEB_ENABLED", true);
const telegramEnabled = envBool("TELEGRAM_ENABLED", false);
const signupEnabled = envBool("SIGNUP_ENABLED", false);
const trustCloudflareHeaders = envBool("TRUST_CLOUDFLARE_HEADERS", false);
const tossPaymentsWebhookEnabled = envBool("TOSS_PAYMENTS_WEBHOOK_ENABLED", false);
const sessionDays = positiveInt("ACCOUNT_SESSION_DAYS", 7, 1, 90);
const liveMarkets = parseLiveMarkets(process.env.LIVE_MARKETS);
const billingPrice = optionalPositiveInt("BILLING_PRO_30D_PRICE");
const billingProDays = positiveInt("BILLING_PRO_DAYS", 30, 1, 366);
const freeProductLimit = positiveInt("FREE_PRODUCT_LIMIT", 20, 1, 100_000);
const freeMarketLimit = positiveInt("FREE_MARKET_LIMIT", 2, 1, MARKETS.length);

if (!Number.isFinite(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
  throw new Error("APPROVAL_TTL_SECONDS must be between 30 and 3600");
}
if (!webEnabled && !telegramEnabled) throw new Error("Enable WEB_ENABLED or TELEGRAM_ENABLED");

const catalog = await ProductCatalog.load(catalogPath);
const approvals = new ApprovalStore(ttlSeconds * 1000, approvalStorePath);
const audit = new AuditLog(auditPath);
const securityAudit = new SecurityAuditLog(securityAuditPath);
const authAbuseGuard = await AuthAbuseGuard.load(authAbuseStatePath);
const feedback = new FeedbackStore(feedbackPath);
const credentials = await EncryptedCredentialStore.create(credentialPath, process.env.MARKET_CREDENTIALS_KEY);
const marketLinksKey = process.env.MARKET_LINKS_KEY?.trim() || process.env.MARKET_CREDENTIALS_KEY?.trim();
const marketLinks = await MarketplaceLinkStore.create(marketLinksPath, marketLinksKey);
const registrationLedger = await RegistrationLedger.load(registrationLedgerPath);
const orderSnapshots = await OrderSnapshotStore.load(orderSnapshotPath);
const recoveredRegistrations = await registrationLedger.reconcileMapped(({ tenantId, market, masterSku }) => {
  const product = catalog.list(tenantId).find((item) => item.masterSku.toLowerCase() === masterSku.toLowerCase());
  const mapping = product?.markets[market];
  if (!mapping?.productId) return null;
  return {
    externalId: mapping.productId,
    ...(mapping.externalId ? { controlExternalId: mapping.externalId } : {})
  };
});
const billingStore = await BillingStore.load(billingStorePath);
const accountStore = await AccountStore.load(accountStorePath, sessionDays);
const billing = new TossPaymentsBillingService(
  billingStore,
  process.env.TOSS_PAYMENTS_SECRET_KEY?.trim() || null,
  process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || null,
  billingPrice,
  billingProDays,
  freeProductLimit,
  freeMarketLimit,
  fetch,
  tossPaymentsWebhookEnabled
);
const marketConnections = new SellerHubMarketConnectionService(
  credentials,
  fetch,
  process.env.LOTTEON_PRODUCT_REGISTER_PATH?.trim() || ""
);
const marketReferences = new PersistingMarketReferenceService(credentials, orderSnapshots);
const registry = buildMarketRegistry({ dryRun, credentials, liveMarkets });
const control = new ControlService(registry);
const interpreter = new CodexCommandInterpreter({
  ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {}),
  workingDirectory: codexWorkdir
});
const naverSolutionId = process.env.NAVER_SOLUTION_ID?.trim() || null;
const naverSolutionPublicKey = optionalPemEnv("NAVER_SOLUTION_PUBLIC_KEY");
const naverSolution = naverSolutionId && naverSolutionPublicKey
  ? { solutionId: naverSolutionId, publicKeyPem: naverSolutionPublicKey }
  : null;

console.log(
  `Seller Control Hub starting. DRY_RUN=${dryRun}; PRODUCT_REGISTRATION_ENABLED=${productRegistrationEnabled}; LIVE_MARKETS=${liveMarkets.join(",") || "none"}; credentialStore=${credentials.ready ? "ready" : "disabled"}; marketLinks=${marketLinks.ready ? "ready" : "disabled"}; naverSolution=${naverSolution ? "ready" : "disabled"}; billing=${billing.status({ userId: "boot", tenantId: "boot", basePlan: "free" }).checkoutMode}; accounts=${accountStore.accountCount()}; recoveredRegistrations=${recoveredRegistrations}; cachedOrders=${orderSnapshots.count()}; trustCloudflareHeaders=${trustCloudflareHeaders}`
);

if (webEnabled) {
  const auth = new WebAuth(
    accountStore,
    process.env.WEB_BETA_TOKENS,
    signupEnabled,
    process.env.SIGNUP_INVITE_CODE?.trim() || null,
    authAbuseGuard,
    securityAudit
  );
  const port = Number(process.env.WEB_PORT ?? "8787");
  const host = process.env.WEB_HOST ?? "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WEB_PORT must be a valid TCP port");

  const server = createWebServer({
    auth,
    billing,
    interpreter,
    catalog,
    approvals,
    control,
    audit,
    feedback,
    credentials,
    marketLinks,
    naverSolution,
    registrationLedger,
    marketConnections,
    marketReferences,
    dryRun,
    productRegistrationEnabled,
    webDistPath,
    publicEgressIp: process.env.PUBLIC_EGRESS_IP?.trim() || null,
    trustCloudflareHeaders
  });
  server.listen(port, host, () => console.log(`Web app/API listening on http://${host}:${port}`));
}

if (telegramEnabled) {
  const telegramToken = required("TELEGRAM_BOT_TOKEN");
  const ownerUserId = Number(required("TELEGRAM_OWNER_USER_ID"));
  const tenantId = process.env.TELEGRAM_TENANT_ID?.trim() || "demo";
  if (!Number.isSafeInteger(ownerUserId)) throw new Error("TELEGRAM_OWNER_USER_ID must be an integer");

  const bot = createTelegramBot({ token: telegramToken, ownerUserId, tenantId, interpreter, catalog, approvals, control, audit });
  bot.start({ onStart: (info) => console.log(`Telegram bot @${info.username} started for tenant ${tenantId}`) });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function positiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function optionalPositiveInt(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function optionalPemEnv(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (raw.startsWith("base64:")) {
    try {
      return Buffer.from(raw.slice("base64:".length), "base64").toString("utf8").trim() || null;
    } catch {
      throw new Error(`${name} base64 value is invalid`);
    }
  }
  return raw.replace(/\\n/g, "\n");
}

function parseLiveMarkets(raw: string | undefined): Market[] {
  if (!raw?.trim()) return [];
  const allowed = new Set<string>(MARKETS);
  const values = [...new Set(raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
  for (const value of values) {
    if (!allowed.has(value)) throw new Error(`LIVE_MARKETS includes unsupported market: ${value}`);
  }
  return values as Market[];
}
