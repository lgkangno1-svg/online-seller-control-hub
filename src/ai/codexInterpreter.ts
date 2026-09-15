import { Codex } from "@openai/codex-sdk";
import { commandSchema, MARKETS, WRITE_ACTIONS, type ParsedCommand } from "../core/types.js";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "productQuery", "markets", "value", "rationale"],
  properties: {
    action: { type: "string", enum: WRITE_ACTIONS },
    productQuery: { type: "string" },
    markets: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: MARKETS } },
    value: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    rationale: { type: "string" }
  }
} as const;

export class CodexCommandInterpreter {
  private readonly codex: Codex;

  constructor(private readonly options: { model?: string; workingDirectory: string }) {
    this.codex = new Codex({ env: pickCodexEnvironment(process.env) });
  }

  async parse(userText: string): Promise<ParsedCommand> {
    const thread = this.codex.startThread({
      ...(this.options.model ? { model: this.options.model } : {}),
      sandboxMode: "read-only",
      workingDirectory: this.options.workingDirectory,
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
      modelReasoningEffort: "low"
    });

    const prompt = `You are a command parser for a Korean online seller control plane.\n\nAllowed markets:\n- naver = 네이버 스마트스토어\n- coupang = 쿠팡\n- gmarket = G마켓/지마켓\n- lotteon = 롯데ON\n- toss = 토스쇼핑\n- kakao = 카카오 톡스토어/톡딜\n\nAllowed write actions only: ${WRITE_ACTIONS.join(", ")}.\nRules:\n1. Never invent a product. Preserve the user's product wording in productQuery.\n2. \"전부\", \"전체\", \"모든 마켓\" means all six markets.\n3. Exclusions such as \"쿠팡 빼고\" must remove that market.\n4. \"품절\" means SET_OUT_OF_STOCK.\n5. \"재고 N개\" means SET_STOCK with value N.\n6. \"가격 N원\" means SET_PRICE with integer won value.\n7. \"판매중지\" means STOP_SALES and \"판매재개\" means RESUME_SALES.\n8. If the message cannot be represented safely, do not guess. Return a deliberately invalid empty productQuery so validation fails.\n9. This parser never executes anything.\n\nUser message:\n${JSON.stringify(userText)}`;

    const result = await thread.run(prompt, { outputSchema });
    const parsed = JSON.parse(result.finalResponse);
    return commandSchema.parse(parsed);
  }
}

function pickCodexEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY", "TMPDIR", "TEMP", "TMP"];
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const value = env[key];
    if (value) out[key] = value;
  }
  return out;
}
