import type { CatalogProduct } from "../catalog/catalog.js";
import type { MarketAdapter } from "./adapter.js";
import type { Market, MarketExecutionResult, MarketState, ParsedCommand } from "../core/types.js";

export class DryRunMarketAdapter implements MarketAdapter {
  private readonly states = new Map<string, MarketState>();

  constructor(public readonly market: Market) {}

  async getState(product: CatalogProduct): Promise<MarketState> {
    const mapping = product.markets[this.market];
    if (!mapping?.externalId) throw new Error(`${this.market}: 제어용 상품/옵션 ID 매핑이 없습니다.`);
    const key = `${product.masterSku}:${this.market}`;
    const current: MarketState = this.states.get(key) ?? {
      market: this.market,
      externalId: mapping.externalId,
      price: null,
      stock: null,
      saleStatus: "UNKNOWN"
    };
    return { ...current };
  }

  async execute(product: CatalogProduct, command: ParsedCommand): Promise<MarketExecutionResult> {
    const before = await this.getState(product);
    const after: MarketState = { ...before };

    switch (command.action) {
      case "SET_OUT_OF_STOCK":
        after.stock = 0;
        after.saleStatus = "OUT_OF_STOCK";
        break;
      case "SET_STOCK":
        after.stock = command.value;
        after.saleStatus = command.value === 0 ? "OUT_OF_STOCK" : "ON_SALE";
        break;
      case "SET_PRICE":
        after.price = command.value;
        break;
      case "STOP_SALES":
        after.saleStatus = "STOPPED";
        break;
      case "RESUME_SALES":
        after.saleStatus = "ON_SALE";
        break;
    }

    this.states.set(`${product.masterSku}:${this.market}`, after);
    return { market: this.market, ok: true, message: "DRY_RUN 성공", before, after };
  }
}
