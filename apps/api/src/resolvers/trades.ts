/**
 * Live recent-trades + top-holders resolvers, backed by public venue data-APIs
 * (no auth). These read the market's platform + externalId from `platform_markets`
 * (by `marketId`), then fetch + map venue JSON into the SDL `BaseTrade` /
 * `MarketPositionGroup` shapes.
 *
 * Money discipline: venue prices are 0..1 (Polymarket) or dollar strings
 * (Kalshi) — exposed on the wire as probability Floats (0..1) for `price`, and
 * integer **microdollars** for `totalValue` (`Math.round(price * size * 1e6)`).
 * Network failures never throw to the client: every fetch path returns [].
 */
import { getDb, platformMarkets } from "@caesar/db";
import { eq } from "drizzle-orm";

// --------------------------------------------------------------------------- //
// Argument shapes
// --------------------------------------------------------------------------- //

export interface MarketTradeFiltersInput {
  minSize?: number | null;
  maxSize?: number | null;
  side?: "BUY" | "SELL" | null;
}

export interface MarketRecentTradesArgs {
  marketId: string;
  before?: string | null;
  limit?: number | null;
  filters?: MarketTradeFiltersInput | null;
}

export interface MarketPositionsArgs {
  marketId: string;
}

// --------------------------------------------------------------------------- //
// Shared fetch helper (small, with timeout). Returns null on any failure.
// --------------------------------------------------------------------------- //

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
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

// --------------------------------------------------------------------------- //
// platform_markets lookup
// --------------------------------------------------------------------------- //

interface VenueRef {
  platform: string;
  externalId: string;
}

async function resolveVenueRef(marketId: string): Promise<VenueRef | null> {
  const db = getDb();
  const [row] = await db
    .select({ platform: platformMarkets.platform, externalId: platformMarkets.externalId })
    .from(platformMarkets)
    .where(eq(platformMarkets.marketId, marketId))
    .limit(1);
  if (!row) return null;
  return { platform: row.platform, externalId: row.externalId };
}

// --------------------------------------------------------------------------- //
// Venue JSON shapes (only the fields we read)
// --------------------------------------------------------------------------- //

interface PolymarketTrade {
  proxyWallet?: string | null;
  side?: string | null;
  asset?: string | null;
  conditionId?: string | null;
  size?: number | null;
  price?: number | null;
  timestamp?: number | null;
  title?: string | null;
  icon?: string | null;
  outcome?: string | null;
  name?: string | null;
  pseudonym?: string | null;
  profileImage?: string | null;
  transactionHash?: string | null;
}

interface KalshiTrade {
  count_fp?: string | null;
  created_time?: string | null;
  yes_price_dollars?: string | null;
  no_price_dollars?: string | null;
  taker_side?: string | null;
  trade_id?: string | null;
  ticker?: string | null;
}

interface KalshiTradesResponse {
  trades?: KalshiTrade[] | null;
}

interface PolymarketHolderEntry {
  token?: string | null;
  holders?: PolymarketHolder[] | null;
}

interface PolymarketHolder {
  proxyWallet?: string | null;
  pseudonym?: string | null;
  name?: string | null;
  amount?: number | null;
  outcomeIndex?: number | null;
  profileImage?: string | null;
}

// --------------------------------------------------------------------------- //
// Mappers → SDL shapes
// --------------------------------------------------------------------------- //

export interface MappedTrader {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isVerified: boolean;
}

export interface MappedTrade {
  key: string;
  transactionHash: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  totalValue: number;
  datetime: string | null;
  platform: string;
  outcomeName: string | null;
  externalMarketId: string | null;
  marketId: string;
  marketQuestion: string | null;
  marketIcon: string | null;
  trader: MappedTrader | null;
}

function mapPolymarketTrade(t: PolymarketTrade, marketId: string): MappedTrade {
  const price = Number(t.price ?? 0);
  const size = Number(t.size ?? 0);
  const asset = t.asset ?? "";
  const txHash = t.transactionHash ?? "";
  const name = t.name ?? null;
  return {
    key: `${txHash}:${asset}`,
    transactionHash: txHash,
    side: t.side === "SELL" ? "SELL" : "BUY",
    price,
    size,
    totalValue: Math.round(price * size * 1e6),
    datetime: new Date(Number(t.timestamp ?? 0) * 1000).toISOString(),
    platform: "polymarket",
    outcomeName: t.outcome ?? null,
    externalMarketId: t.conditionId ?? null,
    marketId,
    marketQuestion: t.title ?? null,
    marketIcon: t.icon ?? null,
    trader: {
      id: t.proxyWallet ?? "",
      platform: "polymarket",
      username: name,
      displayName: t.pseudonym ?? name,
      profileImageUrl: t.profileImage ?? null,
      isVerified: false,
    },
  };
}

function mapKalshiTrade(t: KalshiTrade, marketId: string): MappedTrade {
  const price = Number(t.yes_price_dollars ?? 0);
  const size = Number(t.count_fp ?? 0);
  const isYes = t.taker_side === "yes";
  const tradeId = t.trade_id ?? "";
  return {
    key: tradeId,
    transactionHash: tradeId,
    side: isYes ? "BUY" : "SELL",
    price,
    size,
    totalValue: Math.round(price * size * 1e6),
    datetime: t.created_time ?? null,
    platform: "kalshi",
    outcomeName: isYes ? "Yes" : "No",
    externalMarketId: t.ticker ?? null,
    marketId,
    marketQuestion: null,
    marketIcon: null,
    trader: null,
  };
}

function applyTradeFilters(
  trades: MappedTrade[],
  filters?: MarketTradeFiltersInput | null,
): MappedTrade[] {
  if (!filters) return trades;
  return trades.filter((t) => {
    if (filters.side && t.side !== filters.side) return false;
    if (filters.minSize != null && t.size < filters.minSize) return false;
    if (filters.maxSize != null && t.size > filters.maxSize) return false;
    return true;
  });
}

// --------------------------------------------------------------------------- //
// Resolvers
// --------------------------------------------------------------------------- //

export async function resolveMarketRecentTrades(args: MarketRecentTradesArgs) {
  const limit = args.limit ?? 50;
  try {
    const ref = await resolveVenueRef(args.marketId);
    if (!ref) return [];

    if (ref.platform === "polymarket") {
      const url = `https://data-api.polymarket.com/trades?market=${encodeURIComponent(
        ref.externalId,
      )}&limit=${limit}&takerOnly=false`;
      const data = await fetchJson<PolymarketTrade[]>(url);
      if (!Array.isArray(data)) return [];
      const mapped = data.map((t) => mapPolymarketTrade(t, args.marketId));
      return applyTradeFilters(mapped, args.filters);
    }

    if (ref.platform === "kalshi") {
      const url = `https://api.elections.kalshi.com/trade-api/v2/markets/trades?ticker=${encodeURIComponent(
        ref.externalId,
      )}&limit=${limit}`;
      const data = await fetchJson<KalshiTradesResponse>(url);
      const trades = data?.trades;
      if (!Array.isArray(trades)) return [];
      const mapped = trades.map((t) => mapKalshiTrade(t, args.marketId));
      return applyTradeFilters(mapped, args.filters);
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Same data path as `resolveMarketRecentTrades`; trader enrichment is optional
 * for the "basic" field, so the simplest correct implementation reuses the
 * shared mapping (without applying filters, which the SDL field doesn't accept).
 */
export async function resolveMarketRecentTradesBasic(
  args: Pick<MarketRecentTradesArgs, "marketId" | "before" | "limit">,
) {
  return resolveMarketRecentTrades({
    marketId: args.marketId,
    before: args.before,
    limit: args.limit,
  });
}

export async function resolveMarketPositions(args: MarketPositionsArgs) {
  const limit = 20;
  try {
    const ref = await resolveVenueRef(args.marketId);
    if (!ref) return [];

    // Polymarket only — Kalshi has no public holders endpoint.
    if (ref.platform !== "polymarket") return [];

    const url = `https://data-api.polymarket.com/holders?market=${encodeURIComponent(
      ref.externalId,
    )}&limit=${limit}`;
    const data = await fetchJson<PolymarketHolderEntry[]>(url);
    if (!Array.isArray(data)) return [];

    return data.map((entry) => {
      const token = entry.token ?? "";
      const holders = Array.isArray(entry.holders) ? entry.holders : [];
      const outcomeIndex = holders[0]?.outcomeIndex ?? null;
      return {
        outcomeId: token,
        outcome: outcomeIndex === null ? null : String(outcomeIndex),
        outcomeIndex,
        positions: holders.map((h) => {
          const name = h.name ?? null;
          return {
            proxyWallet: h.proxyWallet ?? null,
            size: h.amount ?? null,
            avgEntryPrice: null,
            currentValue: null,
            unrealizedPnl: null,
            trader: {
              id: h.proxyWallet ?? "",
              platform: "polymarket",
              username: name,
              displayName: h.pseudonym ?? name,
              profileImageUrl: h.profileImage ?? null,
              isVerified: false,
            },
          };
        }),
      };
    });
  } catch {
    return [];
  }
}
