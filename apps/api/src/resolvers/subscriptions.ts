/**
 * Phase 4 realtime — GraphQL subscriptions backed by polling the public venue
 * data-APIs (no Redis; single-node in-process). Each subscription is an async
 * generator that polls on an interval and yields new payloads as they appear.
 *
 * The transport is `graphql-ws` over WebSocket (see ../server.ts); on client
 * disconnect graphql-ws calls `.return()` on the generator, which resumes the
 * `for await`/`yield` point inside the try and runs the `finally`. Sleeps are
 * kept short so a closed generator unwinds promptly.
 */
import { getDb, marketOutcomes } from "@caesar/db";
import { and, eq } from "drizzle-orm";
import { resolveMarketRecentTrades, type MappedTrade } from "./trades.js";
import { resolveMarketOrderbook, type Orderbook } from "./orderbook.js";

/** Cancellable-by-resolution sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TRADE_POLL_MS = 3000;
const STATS_POLL_MS = 5000;
const ORDERBOOK_POLL_MS = 2000;

// --------------------------------------------------------------------------- //
// marketTrades(marketId) — stream new trades for a single market.
// --------------------------------------------------------------------------- //

async function* marketTradesGen(marketId: string): AsyncGenerator<MappedTrade> {
  const seen = new Set<string>();
  try {
    // Prime: record the current trades WITHOUT emitting so we only stream
    // trades that arrive after the subscription starts.
    const initial = await resolveMarketRecentTrades({ marketId, limit: 30 });
    for (const t of initial) seen.add(t.key);

    for (;;) {
      await sleep(TRADE_POLL_MS);
      const trades = await resolveMarketRecentTrades({ marketId, limit: 30 });
      // resolveMarketRecentTrades returns newest-first; emit oldest-first.
      for (let i = trades.length - 1; i >= 0; i--) {
        const t = trades[i];
        if (!t || seen.has(t.key)) continue;
        seen.add(t.key);
        yield t;
      }
    }
  } finally {
    seen.clear();
  }
}

// --------------------------------------------------------------------------- //
// multiMarketTrades(marketIds) — same idea across many markets, merged.
// --------------------------------------------------------------------------- //

async function* multiMarketTradesGen(marketIds: string[]): AsyncGenerator<MappedTrade> {
  const ids = Array.from(new Set(marketIds));
  const seen = new Set<string>();
  try {
    // Prime each market without emitting.
    const initial = await Promise.all(
      ids.map((id) => resolveMarketRecentTrades({ marketId: id, limit: 30 })),
    );
    for (const trades of initial) for (const t of trades) seen.add(t.key);

    for (;;) {
      await sleep(TRADE_POLL_MS);
      const polled = await Promise.all(
        ids.map((id) => resolveMarketRecentTrades({ marketId: id, limit: 30 })),
      );
      for (const trades of polled) {
        for (let i = trades.length - 1; i >= 0; i--) {
          const t = trades[i];
          if (!t || seen.has(t.key)) continue;
          seen.add(t.key);
          yield t;
        }
      }
    }
  } finally {
    seen.clear();
  }
}

// --------------------------------------------------------------------------- //
// marketStats(marketId) — stream the primary outcome's midpoint when it moves.
// --------------------------------------------------------------------------- //

export interface MarketStatsPayload {
  outcomeId: string | null;
  outcomeName: string | null;
  midPoint: number | null;
  midpointMicrodollars: number | null;
  spread: number | null;
  spreadMicrodollars: number | null;
}

async function readPrimaryOutcome(marketId: string): Promise<MarketStatsPayload | null> {
  const db = getDb();
  // Prefer the primary outcome; fall back to any outcome for the market.
  const [primary] = await db
    .select()
    .from(marketOutcomes)
    .where(and(eq(marketOutcomes.marketId, marketId), eq(marketOutcomes.isPrimary, true)))
    .limit(1);
  const row =
    primary ??
    (
      await db
        .select()
        .from(marketOutcomes)
        .where(eq(marketOutcomes.marketId, marketId))
        .limit(1)
    )[0];
  if (!row) return null;

  const midMicro = row.midpointMicro == null ? null : Number(row.midpointMicro);
  const spreadMicro = row.spreadMicro == null ? null : Number(row.spreadMicro);
  return {
    outcomeId: row.outcomeId,
    outcomeName: row.outcomeName ?? null,
    midPoint: midMicro == null ? null : midMicro / 1e6,
    midpointMicrodollars: midMicro,
    spread: spreadMicro == null ? null : spreadMicro / 1e6,
    spreadMicrodollars: spreadMicro,
  };
}

async function* marketStatsGen(marketId: string): AsyncGenerator<MarketStatsPayload> {
  let lastMid: number | null | undefined;
  try {
    for (;;) {
      const payload = await readPrimaryOutcome(marketId);
      if (payload && payload.midpointMicrodollars !== lastMid) {
        lastMid = payload.midpointMicrodollars;
        yield payload;
      }
      await sleep(STATS_POLL_MS);
    }
  } finally {
    // nothing to release
  }
}

// --------------------------------------------------------------------------- //
// orderbookUpdates(marketId) — stream the live CLOB book when it changes.
// Polls /book and emits on hash change (plus the first snapshot, so a client
// that only subscribes still gets current state). Polymarket-only; Kalshi/closed
// markets yield one empty book and then idle.
// --------------------------------------------------------------------------- //

async function* orderbookUpdatesGen(marketId: string): AsyncGenerator<Orderbook> {
  let lastHash: string | null | undefined;
  try {
    for (;;) {
      const book = await resolveMarketOrderbook(marketId);
      if (lastHash === undefined || book.hash !== lastHash) {
        lastHash = book.hash;
        yield book;
      }
      await sleep(ORDERBOOK_POLL_MS);
    }
  } finally {
    // nothing to release
  }
}

// --------------------------------------------------------------------------- //
// Phase 5/2 — fields that exist in the SDL but have no realtime source yet.
// Minimal generators that never emit so the fields resolve without erroring.
// --------------------------------------------------------------------------- //

async function* neverGen(): AsyncGenerator<never> {
  for (;;) {
    await sleep(60_000);
  }
}

// --------------------------------------------------------------------------- //
// Resolver map — graphql-tools/Yoga subscription shape: { subscribe, resolve }.
// --------------------------------------------------------------------------- //

export const subscriptionResolvers = {
  marketTrades: {
    subscribe: (_parent: unknown, args: { marketId: string }) => marketTradesGen(args.marketId),
    resolve: (payload: MappedTrade) => payload,
  },
  multiMarketTrades: {
    subscribe: (_parent: unknown, args: { marketIds: string[] }) =>
      multiMarketTradesGen(args.marketIds),
    resolve: (payload: MappedTrade) => payload,
  },
  marketStats: {
    subscribe: (_parent: unknown, args: { marketId: string }) => marketStatsGen(args.marketId),
    resolve: (payload: MarketStatsPayload) => payload,
  },
  orderbookUpdates: {
    subscribe: (_parent: unknown, args: { marketId: string }) =>
      orderbookUpdatesGen(args.marketId),
    resolve: (payload: Orderbook) => payload,
  },
  // Phase 5/2 — no realtime source yet; never emits.
  trackedTraderTrades: {
    subscribe: () => neverGen(),
    resolve: (payload: unknown) => payload,
  },
  // Phase 5/2 — no realtime source yet; never emits.
  userNotifications: {
    subscribe: () => neverGen(),
    resolve: (payload: unknown) => payload,
  },
};
