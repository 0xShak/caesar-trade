import {
  resolveMarkets,
  resolveHomeMarkets,
  resolveMarket,
  resolveEvent,
  resolveTags,
  type MarketsArgs,
  type HomeMarketsArgs,
  type MarketArgs,
  type EventArgs,
  type TagsArgs,
} from "./markets.js";
import {
  resolveMarketRecentTrades,
  resolveMarketRecentTradesBasic,
  resolveMarketPositions,
  type MarketRecentTradesArgs,
  type MarketPositionsArgs,
} from "./trades.js";

/**
 * Phase 1 resolvers. The market read paths (markets, homeMarkets, market, event,
 * tags) now read the normalized Postgres store via `@caesar/db` (Drizzle); see
 * `./markets.ts` for the money wire-contract and batched child loaders. `health`
 * and `me` stay as simple stubs. Every other Query/Mutation/Subscription field in
 * the SDL is intentionally left unresolved (absent from this map → resolves null
 * rather than erroring) until its phase.
 */

export const resolvers = {
  // Interface type resolvers. Trades/holders return concrete BaseTrade/BaseTrader
  // shapes; the SDL exposes them through the ITrade/ITrader interfaces, which need
  // a __resolveType so GraphQL can pick the object type at runtime.
  ITrader: { __resolveType: () => "BaseTrader" },
  ITrade: { __resolveType: () => "BaseTrade" },

  Query: {
    health: () => "ok",

    markets: (_parent: unknown, args: MarketsArgs) => resolveMarkets(args),

    homeMarkets: (_parent: unknown, args: HomeMarketsArgs) => resolveHomeMarkets(args),

    market: (_parent: unknown, args: MarketArgs) => resolveMarket(args),

    event: (_parent: unknown, args: EventArgs) => resolveEvent(args),

    tags: (_parent: unknown, args: TagsArgs) => resolveTags(args),

    marketRecentTrades: (_parent: unknown, args: MarketRecentTradesArgs) =>
      resolveMarketRecentTrades(args),

    marketRecentTradesBasic: (_parent: unknown, args: MarketRecentTradesArgs) =>
      resolveMarketRecentTradesBasic(args),

    marketPositions: (_parent: unknown, args: MarketPositionsArgs) =>
      resolveMarketPositions(args),

    // Stub user so the FE onboarding gates have something to read.
    me: () => ({
      id: "me_dev_stub",
      tosAccepted: false,
      inviteClaimed: false,
      parityAdmin: false,
      welcomeWizardCompleted: false,
      hasServerSigner: false,
      isSafeDeployed: false,
      hasApiCredentials: false,
      isWalletSetupComplete: false,
    }),
  },
};
