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
import {
  resolveTraders,
  resolveTrader,
  resolveResolveTrader,
  resolveTraderPositions,
  type TradersArgs,
  type TraderArgs,
  type ResolveTraderArgs,
  type TraderPositionsArgs,
} from "./traders.js";
import { subscriptionResolvers } from "./subscriptions.js";
import { resolveMarketPriceHistory, type MarketPriceHistoryArgs } from "./prices.js";
import { resolveMe, resolveSyncTosFromPrivy } from "./me.js";
import type { GraphQLContext } from "../auth.js";

/**
 * Phase 1 resolvers. The market read paths (markets, homeMarkets, market, event,
 * tags) now read the normalized Postgres store via `@caesar/db` (Drizzle); see
 * `./markets.ts` for the money wire-contract and batched child loaders. `health`
 * stays a stub; `me` + `syncTosFromPrivy` are Phase 2 (identity, see `./me.ts`).
 * Every other Query/Mutation/Subscription field in the SDL is intentionally left
 * unresolved (absent from this map → resolves null rather than erroring) until
 * its phase.
 */

export const resolvers = {
  // Interface type resolvers. Trades/holders return concrete BaseTrade/BaseTrader
  // shapes; the SDL exposes them through the ITrade/ITrader interfaces, which need
  // a __resolveType so GraphQL can pick the object type at runtime.
  ITrader: { __resolveType: () => "BaseTrader" },
  ITrade: { __resolveType: () => "BaseTrade" },

  Subscription: subscriptionResolvers,

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

    marketPriceHistory: (_parent: unknown, args: MarketPriceHistoryArgs) =>
      resolveMarketPriceHistory(args),

    traders: (_parent: unknown, args: TradersArgs) => resolveTraders(args),

    trader: (_parent: unknown, args: TraderArgs) => resolveTrader(args),

    resolveTrader: (_parent: unknown, args: ResolveTraderArgs) =>
      resolveResolveTrader(args),

    traderPositions: (_parent: unknown, args: TraderPositionsArgs) =>
      resolveTraderPositions(args),

    // Phase 2: reads the authenticated Privy user from Postgres (null if logged out).
    me: (_parent: unknown, _args: unknown, ctx: GraphQLContext) => resolveMe(ctx),
  },

  Mutation: {
    syncTosFromPrivy: (
      _parent: unknown,
      args: { acceptTos?: boolean | null },
      ctx: GraphQLContext,
    ) => resolveSyncTosFromPrivy(ctx, args.acceptTos),
  },
};
