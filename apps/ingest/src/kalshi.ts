/**
 * Kalshi ingester: pulls live open events/markets from the public Kalshi
 * Elections trade API and maps them to the shared `NormBundle` shape.
 *
 * Money discipline: all price/volume fields are emitted as microdollar
 * `bigint`s produced exclusively via `dollarsToMicro(...)` — never hand-rolled.
 */
import type { NormBundle, NormOutcome, NormTag } from "./normalize.js";
import { getJson } from "./http.js";
import { dollarsToMicro } from "@caesar/money";

// --- Loosely-typed views of the untrusted Kalshi payload --------------------
// Only the fields we read are declared; everything is optional and may be
// undefined/null at runtime, so call sites must guard before use.

interface KalshiPriceRange {
  start?: string | null;
  end?: string | null;
  step?: string | null;
}

interface KalshiMarket {
  ticker?: string | null;
  title?: string | null;
  yes_sub_title?: string | null;
  no_sub_title?: string | null;
  rules_primary?: string | null;
  status?: string | null;
  result?: string | null;
  open_time?: string | null;
  close_time?: string | null;
  expiration_time?: string | null;
  last_price_dollars?: string | null;
  yes_bid_dollars?: string | null;
  yes_ask_dollars?: string | null;
  no_bid_dollars?: string | null;
  no_ask_dollars?: string | null;
  liquidity_dollars?: string | null;
  volume_fp?: string | number | null;
  volume_24h_fp?: string | number | null;
  open_interest_fp?: string | number | null;
  price_ranges?: KalshiPriceRange[] | null;
}

interface KalshiEvent {
  event_ticker?: string | null;
  series_ticker?: string | null;
  title?: string | null;
  sub_title?: string | null;
  category?: string | null;
  markets?: KalshiMarket[] | null;
}

interface EventsResponse {
  cursor?: string | null;
  events?: KalshiEvent[] | null;
}

const API_BASE = "https://api.elections.kalshi.com/trade-api/v2/events";
const PAGE_LIMIT = 200;
const DEFAULT_MAX_EVENTS = 400;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Midpoint price (in micro) from a bid/ask pair, falling back to last trade. */
function mid(
  bid?: string | null,
  ask?: string | null,
  last?: string | null,
): bigint | null {
  if (bid != null && ask != null && Number(bid) > 0 && Number(ask) > 0) {
    return dollarsToMicro((Number(bid) + Number(ask)) / 2);
  }
  if (last != null) return dollarsToMicro(last);
  return null;
}

/** Bid/ask spread (in micro), clamped at zero. */
function spread(bid?: string | null, ask?: string | null): bigint | null {
  if (bid != null && ask != null) {
    return dollarsToMicro(Math.max(0, Number(ask) - Number(bid)));
  }
  return null;
}

function buildBundle(event: KalshiEvent, m: KalshiMarket): NormBundle | null {
  const ticker = m.ticker;
  if (!ticker) return null; // externalId is required

  // Event-level tag (one per category, if present).
  const tags: NormTag[] = event.category
    ? [{ slug: slugify(event.category), label: event.category }]
    : [];

  // earliestResolutionDate = min close_time across the event's markets.
  let earliest: Date | null = null;
  const evMarkets = event.markets ?? [];
  for (const em of evMarkets) {
    const ct = em.close_time;
    if (!ct) continue;
    const d = new Date(ct);
    if (!Number.isNaN(d.getTime()) && (earliest === null || d < earliest)) {
      earliest = d;
    }
  }

  const tickerLc = ticker.toLowerCase();

  // tick size from the first declared price range, default 1 cent.
  const firstRange = m.price_ranges?.[0];
  const stepStr = firstRange?.step;
  const tickSizeMicro =
    stepStr != null ? dollarsToMicro(stepStr) : dollarsToMicro("0.01");

  const yes: NormOutcome = {
    externalOutcomeId: `${ticker}:yes`,
    outcomeName: m.yes_sub_title ?? "Yes",
    isPrimary: true,
    outcomeIndex: 0,
    midpointMicro: mid(m.yes_bid_dollars, m.yes_ask_dollars, m.last_price_dollars),
    spreadMicro: spread(m.yes_bid_dollars, m.yes_ask_dollars),
    result: m.result === "yes" ? "YES" : m.result === "no" ? "NO" : null,
  };

  const no: NormOutcome = {
    externalOutcomeId: `${ticker}:no`,
    outcomeName: m.no_sub_title ?? "No",
    isPrimary: false,
    outcomeIndex: 1,
    midpointMicro: mid(m.no_bid_dollars, m.no_ask_dollars),
    spreadMicro: spread(m.no_bid_dollars, m.no_ask_dollars),
    // NO leg resolves YES when the market's result is "no".
    result: m.result === "no" ? "YES" : m.result === "yes" ? "NO" : null,
  };

  return {
    platform: "kalshi",

    eventExternalId: event.event_ticker ?? null,
    eventTitle: event.title ?? null,
    eventImageUrl: null,
    eventVolumeMicro: null,
    eventLiquidityMicro: null,
    earliestResolutionDate: earliest,

    externalId: ticker,
    platformSlug: tickerLc,
    question: m.title ?? event.title ?? null,
    displayNameShort: m.yes_sub_title ?? event.sub_title ?? null,
    description: m.rules_primary ?? null,
    status: m.status === "active" ? "active" : String(m.status ?? "").toUpperCase(),
    slug: tickerLc,
    icon: null,
    imageUrl: null,
    startDate: m.open_time ? new Date(m.open_time) : null,
    endDate: m.close_time ? new Date(m.close_time) : null,
    resolutionDate: m.expiration_time ? new Date(m.expiration_time) : null,

    // volume_fp/open_interest_fp are CONTRACT COUNTS, not dollars — we treat
    // 1 contract ≈ $1 notional as a coarse volume proxy.
    volumeMicro: m.volume_fp != null ? dollarsToMicro(m.volume_fp) : null,
    liquidityMicro: m.liquidity_dollars != null ? dollarsToMicro(m.liquidity_dollars) : null,
    totalOpenInterestMicro:
      m.open_interest_fp != null ? dollarsToMicro(m.open_interest_fp) : null,
    volume24hMicro: m.volume_24h_fp != null ? dollarsToMicro(m.volume_24h_fp) : null,
    volume24hChangePct: null,

    tickSizeMicro,
    minimumOrderSizeMicro: dollarsToMicro(1), // 1 contract ≈ $1 → 1_000_000n
    feeRateBps: null,
    feeRate: null,
    negRisk: false,

    tags,
    outcomes: [yes, no],
  };
}

export async function fetchKalshiBundles(opts?: {
  maxEvents?: number;
}): Promise<NormBundle[]> {
  const maxEvents = opts?.maxEvents ?? DEFAULT_MAX_EVENTS;
  const bundles: NormBundle[] = [];
  const collected: KalshiEvent[] = [];

  let cursor = "";
  while (collected.length < maxEvents) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      status: "open",
      with_nested_markets: "true",
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${API_BASE}?${params.toString()}`;

    const res = await getJson<EventsResponse>(url, { timeoutMs: 20_000, retries: 3 });
    const events = res.events ?? [];
    if (events.length === 0) break;

    for (const ev of events) {
      collected.push(ev);
      if (collected.length >= maxEvents) break;
    }

    const next = res.cursor;
    if (!next) break;
    cursor = next;
  }

  for (const event of collected) {
    const evMarkets = event.markets ?? [];
    for (const m of evMarkets) {
      if (m.status !== "active") continue;
      try {
        const bundle = buildBundle(event, m);
        if (bundle) bundles.push(bundle);
      } catch {
        // Skip this market on any mapping error; continue with the rest.
        continue;
      }
    }
  }

  return bundles;
}
