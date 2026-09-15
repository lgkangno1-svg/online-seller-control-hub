import type { CatalogProduct } from "../catalog/catalog.js";
import type { Market, MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";

export interface MarketAdapter {
  readonly market: Market;
  getState(product: CatalogProduct): Promise<MarketState>;
  execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult>;
}
