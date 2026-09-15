import type { CatalogProduct } from "../catalog/catalog.js";
import type { Market, MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";
import type { MarketAdapter } from "./adapter.js";

export class UnavailableMarketAdapter implements MarketAdapter {
  constructor(readonly market: Market, private readonly reason: string) {}

  async getState(_product: CatalogProduct): Promise<MarketState> {
    throw new Error(`${this.market}: ${this.reason}`);
  }

  async execute(_product: CatalogProduct, _command: ParsedCommand): Promise<MarketExecutionResult> {
    return { market: this.market, ok: false, message: this.reason };
  }
}
