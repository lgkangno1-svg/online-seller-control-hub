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
