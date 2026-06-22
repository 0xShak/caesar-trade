/**
 * Caesar SDL extension: live CLOB orderbook depth for the market-detail page.
 * Polymarket-only — reads the primary outcome's clobTokenId (externalOutcomeId)
 * and hits the PUBLIC CLOB `/book` endpoint. Kalshi → empty book.
 *
 * Money discipline: levels carry `priceMicrodollars` (price 0..1 × 1e6 = micro-USD
 * per share), mirroring `market_outcomes.midpoint_micro`; `price` keeps the 0..1
 * probability for display, `size` is the share count resting at the level.
 *
 * Network/parse failures NEVER throw: every path returns a well-formed (possibly
 * empty) book, so the detail page degrades gracefully and the polling
 * subscription stays alive.
 */
import { getDb, platformMarkets, marketOutcomes } from "@caesar/db";
import { and, eq } from "drizzle-orm";

export interface OrderbookLevel {
  /** Probability 0..1 (display). */
  price: number;
  /** Micro-USD per share (price × 1e6). */
  priceMicrodollars: number;
  /** Share count resting at this level. */
  size: number;
}

export interface Orderbook {
  marketId: string;
  outcomeId: string | null;
  tokenId: string | null;
  /** Highest price first. */
  bids: OrderbookLevel[];
  /** Lowest price first. */
  asks: OrderbookLevel[];
  midpointMicrodollars: number | null;
  spreadMicrodollars: number | null;
  tickSize: number | null;
  /** Upstream book timestamp (ms). */
  timestamp: number | null;
  /** Upstream book hash — used to dedupe subscription emissions. */
  hash: string | null;
}

interface RawLevel {
  price?: string | number | null;
  size?: string | number | null;
}
interface RawBook {
  bids?: RawLevel[] | null;
  asks?: RawLevel[] | null;
  tick_size?: string | number | null;
  timestamp?: string | number | null;
  hash?: string | null;
}

const CLOB_BOOK_URL = "https://clob.polymarket.com/book";
/** Cap levels per side — the detail-page ladder shows far fewer; bounds payload. */
const MAX_LEVELS = 50;

async function fetchJson<T>(url: string, timeoutMs = 6000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function emptyBook(
  marketId: string,
  outcomeId: string | null,
  tokenId: string | null,
): Orderbook {
  return {
    marketId,
    outcomeId,
    tokenId,
    bids: [],
    asks: [],
    midpointMicrodollars: null,
    spreadMicrodollars: null,
    tickSize: null,
    timestamp: null,
    hash: null,
  };
}

function mapLevels(raw: RawLevel[] | null | undefined, dir: "bid" | "ask"): OrderbookLevel[] {
  const levels = (raw ?? [])
    .map((l) => ({ price: Number(l?.price), size: Number(l?.size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0)
    .map((l) => ({
      price: l.price,
      priceMicrodollars: Math.round(l.price * 1e6),
      size: l.size,
    }));
  // bids: highest price first; asks: lowest price first.
  levels.sort((a, b) => (dir === "bid" ? b.price - a.price : a.price - b.price));
  return levels.slice(0, MAX_LEVELS);
}

/** Primary-outcome Polymarket clobTokenId for a market, or nulls when N/A. */
async function primaryToken(
  marketId: string,
): Promise<{ outcomeId: string | null; tokenId: string | null }> {
  const db = getDb();
  const [pm] = await db
    .select({ platform: platformMarkets.platform })
    .from(platformMarkets)
    .where(eq(platformMarkets.marketId, marketId))
    .limit(1);
  if (!pm || pm.platform !== "polymarket") return { outcomeId: null, tokenId: null };

  const [outcome] = await db
    .select({
      outcomeId: marketOutcomes.outcomeId,
      externalOutcomeId: marketOutcomes.externalOutcomeId,
    })
    .from(marketOutcomes)
    .where(and(eq(marketOutcomes.marketId, marketId), eq(marketOutcomes.isPrimary, true)))
    .limit(1);
  return {
    outcomeId: outcome?.outcomeId ?? null,
    tokenId: outcome?.externalOutcomeId ?? null,
  };
}

/** Fetch + normalize the live book for a market. Never throws. */
export async function resolveMarketOrderbook(marketId: string): Promise<Orderbook> {
  try {
    const { outcomeId, tokenId } = await primaryToken(marketId);
    if (!tokenId) return emptyBook(marketId, outcomeId, tokenId);

    const raw = await fetchJson<RawBook>(
      `${CLOB_BOOK_URL}?token_id=${encodeURIComponent(tokenId)}`,
    );
    if (!raw) return emptyBook(marketId, outcomeId, tokenId);

    const bids = mapLevels(raw.bids, "bid");
    const asks = mapLevels(raw.asks, "ask");
    const bestBid = bids[0]?.priceMicrodollars ?? null;
    const bestAsk = asks[0]?.priceMicrodollars ?? null;
    const haveBoth = bestBid != null && bestAsk != null;

    const num = (v: unknown) =>
      v != null && Number.isFinite(Number(v)) ? Number(v) : null;

    return {
      marketId,
      outcomeId,
      tokenId,
      bids,
      asks,
      midpointMicrodollars: haveBoth ? Math.round((bestBid + bestAsk) / 2) : null,
      spreadMicrodollars: haveBoth ? bestAsk - bestBid : null,
      tickSize: num(raw.tick_size),
      timestamp: num(raw.timestamp),
      hash: raw.hash ?? null,
    };
  } catch {
    return emptyBook(marketId, null, null);
  }
}
