import { Bot, InlineKeyboard } from "grammy";
import type { CodexCommandInterpreter } from "../ai/codexInterpreter.js";
import type { ProductCatalog } from "../catalog/catalog.js";
import type { ApprovalStore } from "../core/approvalStore.js";
import type { ControlService } from "../core/controlService.js";
import type { AuditLog } from "../persistence/auditLog.js";
import type { MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";

export function createTelegramBot(deps: {
  token: string;
  ownerUserId: number;
  tenantId: string;
  interpreter: CodexCommandInterpreter;
  catalog: ProductCatalog;
  approvals: ApprovalStore;
  control: ControlService;
  audit: AuditLog;
}): Bot {
  const bot = new Bot(deps.token);

  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== deps.ownerUserId) {
      await ctx.reply("접근이 허용되지 않은 계정입니다.");
      return;
    }
    await next();
  });

  bot.command("start", (ctx) => ctx.reply("Seller Control Hub 준비 완료. 예: ‘홍옥 5kg 전 마켓 품절시켜줘’"));

  bot.on("message:text", async (ctx) => {
    try {
      const command = await deps.interpreter.parse(ctx.message.text);
      const resolved = deps.catalog.resolve(command.productQuery, deps.tenantId);
      if (resolved.kind === "missing") {
        await ctx.reply(`상품을 찾지 못했습니다: ${command.productQuery}\n먼저 마스터 SKU/별칭을 상품 카탈로그에 등록하세요.`);
        return;
      }
      if (resolved.kind === "ambiguous") {
        await ctx.reply(`상품이 여러 개 일치합니다. 더 정확히 입력하세요:\n${resolved.products.map((product) => `- ${product.name} (${product.masterSku})`).join("\n")}`);
        return;
      }

      const snapshot = await deps.control.snapshot(resolved.product, command);
      const actor = { kind: "telegram" as const, id: `${deps.tenantId}:${ctx.from.id}` };
      const approval = deps.approvals.create({ actor, command, product: resolved.product, snapshot });
      const keyboard = new InlineKeyboard()
        .text("✅ 실행", `approve:${approval.id}`)
        .text("❌ 취소", `cancel:${approval.id}`);
      await ctx.reply(formatApproval(resolved.product.name, resolved.product.masterSku, command, snapshot), { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply(`명령을 안전하게 해석하지 못했습니다. 실행하지 않았습니다.\n${error instanceof Error ? error.message : String(error)}`);
    }
  });

  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const id = ctx.callbackQuery.data.slice("approve:".length);
    const actor = { kind: "telegram" as const, id: `${deps.tenantId}:${ctx.from.id}` };
    const approval = deps.approvals.consume(id, actor);
    if (!approval) {
      await ctx.answerCallbackQuery({ text: "만료되었거나 이미 처리된 승인입니다." });
      return;
    }
    await ctx.answerCallbackQuery({ text: "실행합니다." });
    const results = await deps.control.execute(approval.product, approval.command);
    await deps.audit.record({ actor, masterSku: approval.product.masterSku, command: approval.command, results });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply(formatResults(results));
  });

  bot.callbackQuery(/^cancel:(.+)$/, async (ctx) => {
    const id = ctx.callbackQuery.data.slice("cancel:".length);
    const actor = { kind: "telegram" as const, id: `${deps.tenantId}:${ctx.from.id}` };
    const cancelled = deps.approvals.cancel(id, actor);
    await ctx.answerCallbackQuery({ text: cancelled ? "취소했습니다." : "이미 만료되었거나 처리된 명령입니다." });
    if (cancelled) {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      await ctx.reply("❌ 명령을 취소했습니다. 어떤 마켓에도 변경을 보내지 않았습니다.");
    }
  });

  return bot;
}

function formatApproval(name: string, sku: string, command: ParsedCommand, states: MarketState[]): string {
  const action = actionText(command);
  const lines = states.map((state) => `- ${state.market}: 가격 ${fmt(state.price)} / 재고 ${fmt(state.stock)} / ${state.saleStatus}`);
  return [
    "⚠️ 실행 전 확인",
    `상품: ${name}`,
    `SKU: ${sku}`,
    `명령: ${action}`,
    `대상: ${command.markets.join(", ")}`,
    "",
    "현재 상태:",
    ...lines,
    "",
    "아래 [실행]을 눌러야 실제 작업 단계로 진행됩니다."
  ].join("\n");
}

function actionText(command: ParsedCommand): string {
  switch (command.action) {
    case "SET_OUT_OF_STOCK": return "품절 처리";
    case "SET_STOCK": return `재고 ${command.value}개로 변경`;
    case "SET_PRICE": return `판매가 ${command.value?.toLocaleString("ko-KR")}원으로 변경`;
    case "STOP_SALES": return "판매중지";
    case "RESUME_SALES": return "판매재개";
  }
}

function formatResults(results: MarketExecutionResult[]): string {
  return ["실행 결과", ...results.map((result) => `${result.ok ? "✅" : "❌"} ${result.market}: ${result.message}`)].join("\n");
}

function fmt(value: number | null): string {
  return value === null ? "미확인" : value.toLocaleString("ko-KR");
}
