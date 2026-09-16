import assert from "node:assert/strict";
import test from "node:test";
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

test("approved execution writes when live state still matches the approved snapshot", async () => {
  let executeCalls = 0;
  const adapter: MarketAdapter = {
    market: "naver",
    getState: async () => state(10),
    execute: async () => {
      executeCalls += 1;
      return { market: "naver" as const, ok: true, message: "ok" };
    }
  };
  const service = new ControlService(new Map([["naver", adapter]]));

  const results = await service.executeApproved(product, command, [state(10)]);

  assert.equal(executeCalls, 1);
  assert.equal(results[0]?.ok, true);
});

test("approved execution fails closed without writing when state changed after approval", async () => {
  let executeCalls = 0;
  const adapter: MarketAdapter = {
    market: "naver",
    getState: async () => state(7),
    execute: async () => {
      executeCalls += 1;
      return { market: "naver" as const, ok: true, message: "ok" };
    }
  };
  const service = new ControlService(new Map([["naver", adapter]]));

  const results = await service.executeApproved(product, command, [state(10)]);

  assert.equal(executeCalls, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.ok, false);
  assert.match(results[0]?.message ?? "", /다시 승인/);
});
