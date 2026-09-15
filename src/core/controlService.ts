import type { CatalogProduct } from "../catalog/catalog.js";
import type { MarketAdapter } from "../markets/adapter.js";
import type { Market, MarketExecutionResult, MarketState, ParsedCommand } from "./types.js";

export class ControlService {
  constructor(private readonly adapters: Map<Market, MarketAdapter>) {}

  async snapshot(product: CatalogProduct, command: ParsedCommand): Promise<MarketState[]> {
    const states: MarketState[] = [];
    for (const market of command.markets) {
      const adapter = this.adapters.get(market);
      if (!adapter) throw new Error(`${market}: adapter unavailable`);
      states.push(await adapter.getState(product));
    }
    return states;
  }

  async executeApproved(product: CatalogProduct, command: ParsedCommand, approvedSnapshot: MarketState[]): Promise<MarketExecutionResult[]> {
    const current = await this.snapshot(product, command);
    if (!sameSnapshot(approvedSnapshot, current)) {
      return command.markets.map((market) => ({
        market,
        ok: false,
        message: "승인 후 마켓 상태가 변경되어 실행하지 않았습니다. 최신 상태를 확인한 뒤 다시 승인하세요."
      }));
    }
    return this.execute(product, command);
  }

  async execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult[]> {
    const tasks = command.markets.map(async (market): Promise<MarketExecutionResult> => {
      const adapter = this.adapters.get(market);
      if (!adapter) return { market, ok: false, message: "adapter unavailable" };
      try {
        return await adapter.execute(product, command);
      } catch (error) {
        return { market, ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    });
    return Promise.all(tasks);
  }
}

function sameSnapshot(approved: MarketState[], current: MarketState[]): boolean {
  if (approved.length !== current.length) return false;
  const byMarket = new Map(current.map((state) => [state.market, state]));
  return approved.every((state) => {
    const latest = byMarket.get(state.market);
    return latest !== undefined
      && latest.externalId === state.externalId
      && latest.price === state.price
      && latest.stock === state.stock
      && latest.saleStatus === state.saleStatus;
  });
}
