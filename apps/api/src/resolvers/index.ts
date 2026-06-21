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

/**
 * Phase 1 resolvers. The market read paths (markets, homeMarkets, market, event,
 * tags) now read the normalized Postgres store via `@caesar/db` (Drizzle); see
 * `./markets.ts` for the money wire-contract and batched child loaders. `health`
 * and `me` stay as simple stubs. Every other Query/Mutation/Subscription field in
 * the SDL is intentionally left unresolved (absent from this map → resolves null
 * rather than erroring) until its phase.
 */

export const resolvers = {
  Query: {
    health: () => "ok",

    markets: (_parent: unknown, args: MarketsArgs) => resolveMarkets(args),

    homeMarkets: (_parent: unknown, args: HomeMarketsArgs) => resolveHomeMarkets(args),

    market: (_parent: unknown, args: MarketArgs) => resolveMarket(args),

    event: (_parent: unknown, args: EventArgs) => resolveEvent(args),

    tags: (_parent: unknown, args: TagsArgs) => resolveTags(args),

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
