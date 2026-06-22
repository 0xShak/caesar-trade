/**
 * Primary-outcome price history for the market-detail chart (Caesar SDL
 * extension `marketPriceHistory`). Polymarket-only: reads the primary outcome's
 * clobTokenId from `market_outcomes`, then hits the PUBLIC CLOB
 * `/prices-history` endpoint. Kalshi has no equivalent public series here →
 * returns []. Network failures never throw: every path returns [].
 *
 * Wire contract: `t` = unix SECONDS (Int), `p` = probability 0..1 (Float) —
 * matches MarketOutcome.midPoint's 0..1 convention.
 */
import { getDb, platformMarkets, marketOutcomes } from "@caesar/db";
import { and, eq } from "drizzle-orm";

export interface MarketPriceHistoryArgs {
  marketId: string;
  interval?: string | null;
  fidelity?: number | null;
}

interface PricesHistoryResponse {
  history?: Array<{ t?: number | null; p?: number | null }> | null;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Valid CLOB interval windows; anything else falls back to "1w". */
const VALID_INTERVALS = new Set(["1m", "1w", "1d", "6h", "1h", "max"]);

export async function resolveMarketPriceHistory(args: MarketPriceHistoryArgs) {
  try {
    const db = getDb();

    // Must be a Polymarket market to have a CLOB token / price series.
    const [pm] = await db
      .select({ platform: platformMarkets.platform })
      .from(platformMarkets)
      .where(eq(platformMarkets.marketId, args.marketId))
      .limit(1);
    if (!pm || pm.platform !== "polymarket") return [];

    // Primary outcome's clobTokenId (externalOutcomeId).
    const [outcome] = await db
      .select({ externalOutcomeId: marketOutcomes.externalOutcomeId })
      .from(marketOutcomes)
      .where(and(eq(marketOutcomes.marketId, args.marketId), eq(marketOutcomes.isPrimary, true)))
      .limit(1);
    const tokenId = outcome?.externalOutcomeId;
    if (!tokenId) return [];

    const interval = args.interval && VALID_INTERVALS.has(args.interval) ? args.interval : "1w";
    const fidelity = args.fidelity && args.fidelity > 0 ? Math.floor(args.fidelity) : 60;

    const url =
      `https://clob.polymarket.com/prices-history?market=${encodeURIComponent(tokenId)}` +
      `&interval=${interval}&fidelity=${fidelity}`;
    const data = await fetchJson<PricesHistoryResponse>(url);
    const history = data?.history;
    if (!Array.isArray(history)) return [];

    return history
      .filter((pt) => pt && pt.t != null && pt.p != null)
      .map((pt) => ({ t: Math.floor(Number(pt.t)), p: Number(pt.p) }));
  } catch {
    return [];
  }
}
