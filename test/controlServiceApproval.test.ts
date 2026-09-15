import { describe, expect, it, vi } from "vitest";
import { ControlService } from "../src/core/controlService.js";
import type { MarketAdapter } from "../src/markets/adapter.js";
import type { CatalogProduct } from "../src/catalog/catalog.js";
import type { MarketState, ParsedCommand } from "../src/core/types.js";

const product = {
  tenantId: "owner",
  masterSku: "SKU-1",
  name: "테스트 상품",
  aliases: [],
  markets: { naver: { externalId: "naver-1" } }
} as CatalogProduct;

const command: ParsedCommand = {
  action: "SET_STOCK",
  productQuery: "SKU-1",
  markets: ["naver"],
  value: 5
};

function state(stock: number): MarketState {
  return { market: "naver", externalId: "naver-1", price: 10000, stock, saleStatus: "ON_SALE" };
}

describe("ControlService approved execution", () => {
  it("executes when the live state still matches the approved snapshot", async () => {
    const execute = vi.fn(async () => ({ market: "naver" as const, ok: true, message: "ok" }));
    const adapter: MarketAdapter = { market: "naver", getState: vi.fn(async () => state(10)), execute };
    const service = new ControlService(new Map([["naver", adapter]]));

    const results = await service.executeApproved(product, command, [state(10)]);

    expect(execute).toHaveBeenCalledOnce();
    expect(results[0]?.ok).toBe(true);
  });

  it("fails closed without writing when state changed after approval", async () => {
    const execute = vi.fn(async () => ({ market: "naver" as const, ok: true, message: "ok" }));
    const adapter: MarketAdapter = { market: "naver", getState: vi.fn(async () => state(7)), execute };
    const service = new ControlService(new Map([["naver", adapter]]));

    const results = await service.executeApproved(product, command, [state(10)]);

    expect(execute).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.message).toContain("다시 승인");
  });
});
