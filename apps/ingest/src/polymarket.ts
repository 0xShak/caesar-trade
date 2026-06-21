/**
 * Polymarket ingester: pulls live markets from the public gamma API
 * (https://gamma-api.polymarket.com) and maps them into the shared NormBundle
 * shape. One NormBundle is produced per open market, carrying its parent
 * event's fields. No CLOB calls — gamma already provides tickSize, minOrderSize,
 * and prices.
 */
import type { NormBundle, NormOutcome, NormTag } from "./normalize.js";
import { getJson } from "./http.js";
import { dollarsToMicro } from "@caesar/money";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const PAGE_SIZE = 100;
const DEFAULT_MAX_EVENTS = 400;

/** Untrusted gamma tag shape. */
interface GammaTag {
  id?: string | number;
  label?: string;
  slug?: string;
}

/** Untrusted gamma market shape. All fields loose since the API is untrusted. */
interface GammaMarket {
  conditionId?: string;
  slug?: string;
  question?: string;
  groupItemTitle?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  icon?: string;
  image?: string;
  startDate?: string;
  endDate?: string;
  volume?: string | number;
  volumeNum?: string | number;
  liquidity?: string | number;
  liquidityNum?: string | number;
  volume24hr?: string | number;
  orderPriceMinTickSize?: string | number;
  orderMinSize?: string | number;
  negRisk?: boolean;
  // JSON-encoded string arrays
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
}

/** Untrusted gamma event shape. */
interface GammaEvent {
  id?: string | number;
  title?: string;
  image?: string;
  volume?: string | number;
  liquidity?: string | number;
  endDate?: string;
  tags?: GammaTag[];
  markets?: GammaMarket[];
}

/** Parse a JSON-encoded string array into a string[]; null on failure. */
function parseStringArray(raw: string | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((v) => String(v));
  } catch {
    return null;
  }
}

function mapTags(event: GammaEvent): NormTag[] {
  const out: NormTag[] = [];
  for (const t of event.tags ?? []) {
    if (!t.slug) continue;
    out.push({ slug: t.slug, label: t.label ?? null });
  }
  return out;
}

function mapMarket(m: GammaMarket, event: GammaEvent, tags: NormTag[]): NormBundle | null {
  if (m.closed === true || m.archived === true || m.enableOrderBook === false) return null;
  if (!m.conditionId) return null;

  const outcomes = parseStringArray(m.outcomes);
  if (!outcomes || outcomes.length === 0) return null;
  const outcomePrices = parseStringArray(m.outcomePrices);
  const clobTokenIds = parseStringArray(m.clobTokenIds);

  const normOutcomes: NormOutcome[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const tokenId = clobTokenIds?.[i];
    const price = outcomePrices?.[i];
    normOutcomes.push({
      externalOutcomeId: tokenId ?? `${m.conditionId}:${i}`,
      outcomeName: outcomes[i] ?? null,
      isPrimary: i === 0,
      outcomeIndex: i,
      midpointMicro: price != null ? dollarsToMicro(price) : null,
      spreadMicro: null,
      result: null,
    });
  }

  const liquidityRaw = m.liquidity ?? m.liquidityNum;

  return {
    platform: "polymarket",

    eventExternalId: String(event.id),
    eventTitle: event.title ?? null,
    eventImageUrl: event.image ?? null,
    eventVolumeMicro: event.volume != null ? dollarsToMicro(event.volume) : null,
    eventLiquidityMicro: event.liquidity != null ? dollarsToMicro(event.liquidity) : null,
    earliestResolutionDate: event.endDate ? new Date(event.endDate) : null,

    externalId: m.conditionId,
    platformSlug: m.slug ?? null,
    question: m.question ?? null,
    displayNameShort: m.groupItemTitle ?? null,
    description: m.description ?? null,
    status: m.active ? "active" : "CLOSED",
    slug: m.slug ?? null,
    icon: m.icon ?? null,
    imageUrl: m.image ?? null,
    startDate: m.startDate ? new Date(m.startDate) : null,
    endDate: m.endDate ? new Date(m.endDate) : null,
    resolutionDate: null,

    volumeMicro: dollarsToMicro(m.volume ?? m.volumeNum ?? 0),
    liquidityMicro: liquidityRaw != null ? dollarsToMicro(liquidityRaw) : null,
    totalOpenInterestMicro: null,
    volume24hMicro: m.volume24hr != null ? dollarsToMicro(m.volume24hr) : null,
    volume24hChangePct: null,

    tickSizeMicro:
      m.orderPriceMinTickSize != null ? dollarsToMicro(m.orderPriceMinTickSize) : null,
    minimumOrderSizeMicro: m.orderMinSize != null ? dollarsToMicro(m.orderMinSize) : null,
    feeRateBps: 0,
    feeRate: 0,
    negRisk: (m.negRisk ?? false) === true,

    tags,
    outcomes: normOutcomes,
  };
}

export async function fetchPolymarketBundles(opts?: {
  maxEvents?: number;
}): Promise<NormBundle[]> {
  const maxEvents = opts?.maxEvents ?? DEFAULT_MAX_EVENTS;
  const bundles: NormBundle[] = [];
  let collected = 0;

  for (let offset = 0; collected < maxEvents; offset += PAGE_SIZE) {
    const url =
      `${GAMMA_BASE}/events?limit=${PAGE_SIZE}&offset=${offset}` +
      `&closed=false&order=volume24hr&ascending=false`;
    const events = await getJson<GammaEvent[]>(url, { retries: 3 });

    if (!Array.isArray(events) || events.length === 0) break;

    for (const event of events) {
      collected++;
      const tags = mapTags(event);
      for (const m of event.markets ?? []) {
        try {
          const bundle = mapMarket(m, event, tags);
          if (bundle) bundles.push(bundle);
        } catch {
          continue;
        }
      }
    }

    if (events.length < PAGE_SIZE) break;
  }

  return bundles;
}
