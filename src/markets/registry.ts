import { MARKETS, type Market } from "../core/types.js";
import type { EncryptedCredentialStore } from "../persistence/credentialStore.js";
import type { MarketAdapter } from "./adapter.js";
import { CoupangMarketAdapter } from "./coupangAdapter.js";
import { DryRunMarketAdapter } from "./dryRunAdapter.js";
import { TossMarketAdapter } from "./tossAdapter.js";
import { UnavailableMarketAdapter } from "./unavailableAdapter.js";

// Naver is excluded until Commerce Solution SELLER/accountUid delegation is
// integration-tested. Gmarket is excluded until SellerHub's seller-tool account
// is approved for production. Neither can be enabled by LIVE_MARKETS alone.
const LIVE_WRITE_ADAPTER_MARKETS = new Set<Market>(["coupang", "toss"]);

export function buildMarketRegistry(options: {
  dryRun: boolean;
  credentials: EncryptedCredentialStore;
  liveMarkets?: readonly Market[];
}): Map<Market, MarketAdapter> {
  if (options.dryRun) {
    return new Map(MARKETS.map((market) => [market, new DryRunMarketAdapter(market)]));
  }

  if (!options.credentials.ready) {
    throw new Error("Live mode requires the encrypted marketplace credential store to be configured");
  }

  const liveMarkets = new Set(options.liveMarkets ?? []);
  if (liveMarkets.size === 0) {
    throw new Error("Live mode requires at least one explicitly enabled LIVE_MARKETS entry");
  }

  const unsupportedLiveMarkets = [...liveMarkets].filter((market) => !LIVE_WRITE_ADAPTER_MARKETS.has(market));
  if (unsupportedLiveMarkets.length > 0) {
    throw new Error(
      `LIVE_MARKETS includes markets whose real write adapters have not passed integration testing: ${unsupportedLiveMarkets.join(",")}`
    );
  }

  const adapters = new Map<Market, MarketAdapter>();
  for (const market of MARKETS) {
    if (!liveMarkets.has(market)) {
      adapters.set(market, new UnavailableMarketAdapter(market, "live access is not enabled for this market"));
      continue;
    }

    if (market === "coupang") {
      adapters.set(market, new CoupangMarketAdapter(options.credentials));
      continue;
    }
    if (market === "toss") {
      adapters.set(market, new TossMarketAdapter(options.credentials));
      continue;
    }

    adapters.set(market, new UnavailableMarketAdapter(market, "real adapter has not passed integration testing yet"));
  }
  return adapters;
}
