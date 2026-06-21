/**
 * Postgres-backed market read paths (Phase 1).
 *
 * Reads the normalized store via `@caesar/db` (Drizzle) and shapes rows into the
 * GraphQL SDL types (`Market`, `MarketItemListEntry`, `MarketConnection`,
 * `MarketOutcome`, `PlatformMarket`, `Tag`, `Event`). Money discipline: DB stores
 * microdollar `bigint`s in `*Micro` columns; the SDL exposes money as `Float`.
 * See `micro()` and the per-field conversions below for the wire contract.
 */
import {
  getDb,
  markets,
  platformMarkets,
  marketOutcomes,
  events,
  platformEvents,
  tags,
  marketTags,
  type MarketRow,
  type PlatformMarketRow,
  type MarketOutcomeRow,
  type EventRow,
  type TagRow,
} from "@caesar/db";
import {
  eq,
  and,
  ilike,
  inArray,
  gte,
  lte,
  asc,
  desc,
  count,
  sql,
  type SQL,
} from "drizzle-orm";

// --------------------------------------------------------------------------- //
// Money helper (wire contract)
// --------------------------------------------------------------------------- //

/** Microdollar bigint → JS number; null-safe. */
function micro(x: bigint | null): number | null {
  return x === null ? null : Number(x);
}

/** Microdollar price/probability bigint → 0..1 float; null-safe. */
function microToProbability(x: bigint | null): number | null {
  return x === null ? null : Number(x) / 1e6;
}

/** Filter-input Float (microdollars) → bigint for column comparison. */
function dollarsFloatToMicroBigint(value: number): bigint {
  return BigInt(Math.round(value));
}

// --------------------------------------------------------------------------- //
// Argument / filter shapes
// --------------------------------------------------------------------------- //

export interface MarketFiltersInput {
  status?: string | null;
  platforms?: string[] | null;
  includedTags?: string[] | null;
  excludedTags?: string[] | null;
  probabilityMin?: number | null;
  probabilityMax?: number | null;
  spreadMin?: number | null;
  spreadMax?: number | null;
  endDateMin?: number | null;
  endDateMax?: number | null;
  volume24hMin?: number | null;
  liquidityMin?: number | null;
  bookmarked?: boolean | null;
  withPosition?: boolean | null;
}

export interface MarketsArgs {
  limit?: number | null;
  offset?: number | null;
  sortBy?: string | null;
  sortOrder?: string | null;
  search?: string | null;
  filterInput?: MarketFiltersInput | null;
  marketIds?: string[] | null;
}

export interface HomeMarketsArgs {
  limit?: number | null;
  sortBy?: string | null;
  status?: string | null;
  filterInput?: MarketFiltersInput | null;
}

export interface MarketArgs {
  id?: string | null;
  slug?: string | null;
  platform?: string | null;
}

export interface EventArgs {
  id: string;
}

export interface TagsArgs {
  search?: string | null;
  requiredSlugs?: string[] | null;
}

// --------------------------------------------------------------------------- //
// Row → SDL shapers
// --------------------------------------------------------------------------- //

function shapeOutcome(o: MarketOutcomeRow) {
  return {
    outcomeId: o.outcomeId,
    externalOutcomeId: o.externalOutcomeId,
    outcomeName: o.outcomeName,
    isPrimary: o.isPrimary,
    midPoint: microToProbability(o.midpointMicro),
    spread: microToProbability(o.spreadMicro),
    result: o.result,
    apy: o.apy,
    outcomeIndex: o.outcomeIndex,
    midpointMicrodollars: micro(o.midpointMicro),
    spreadMicrodollars: micro(o.spreadMicro),
  };
}

function shapePlatformMarket(p: PlatformMarketRow) {
  return {
    id: p.id,
    marketId: p.marketId,
    externalId: p.externalId,
    platform: p.platform,
    platformSlug: p.platformSlug,
    question: p.question,
    displayNameShort: p.displayNameShort,
    eventTitle: p.eventTitle,
    imageUrl: p.imageUrl,
    icon: p.icon,
    endDate: p.endDate,
    tickSize: p.tickSizeMicro === null ? null : Number(p.tickSizeMicro) / 1e6,
    minimumOrderSize:
      p.minimumOrderSizeMicro === null ? null : Number(p.minimumOrderSizeMicro) / 1e6,
    feeRateBps: p.feeRateBps,
    feeRate: p.feeRate,
    negRisk: p.negRisk,
    priceChange24hMicrodollars: micro(p.priceChange24hMicro),
  };
}

function shapeTag(t: TagRow) {
  return {
    slug: t.slug,
    label: t.label,
    activeMarketCount: t.activeMarketCount,
  };
}

function shapeListEntry(
  m: MarketRow,
  outcomesByMarket: Map<string, MarketOutcomeRow[]>,
  platformMarketsByMarket: Map<string, PlatformMarketRow[]>,
  tagsByMarket: Map<string, TagRow[]>,
) {
  return {
    id: m.id,
    eventId: m.eventId,
    question: m.question,
    displayNameShort: m.displayNameShort,
    eventTitle: m.eventTitle,
    description: m.description,
    status: m.status,
    startDate: m.startDate,
    endDate: m.endDate,
    resolutionDate: m.resolutionDate,
    volume: micro(m.volumeMicro),
    liquidity: micro(m.liquidityMicro),
    icon: m.icon,
    slug: m.slug,
    platform: m.platform,
    tags: (tagsByMarket.get(m.id) ?? []).map(shapeTag),
    outcomes: (outcomesByMarket.get(m.id) ?? []).map(shapeOutcome),
    platformMarkets: (platformMarketsByMarket.get(m.id) ?? []).map(shapePlatformMarket),
    volume1h: micro(m.volume1hMicro),
    volume24h: micro(m.volume24hMicro),
    volume1hChangePct: m.volume1hChangePct,
    volume24hChangePct: m.volume24hChangePct,
    priceChange1hMicrodollars: micro(m.priceChange1hMicro),
    priceChange24hMicrodollars: micro(m.priceChange24hMicro),
    priceChange1hPct: m.priceChange1hPct,
    priceChange24hPct: m.priceChange24hPct,
  };
}

// --------------------------------------------------------------------------- //
// Batched child loaders (avoid N+1: one query per child kind per page)
// --------------------------------------------------------------------------- //

async function loadOutcomes(
  db: ReturnType<typeof getDb>,
  marketIds: string[],
): Promise<Map<string, MarketOutcomeRow[]>> {
  const grouped = new Map<string, MarketOutcomeRow[]>();
  if (marketIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(marketOutcomes)
    .where(inArray(marketOutcomes.marketId, marketIds));
  for (const row of rows) {
    const list = grouped.get(row.marketId);
    if (list) list.push(row);
    else grouped.set(row.marketId, [row]);
  }
  return grouped;
}

async function loadPlatformMarkets(
  db: ReturnType<typeof getDb>,
  marketIds: string[],
): Promise<Map<string, PlatformMarketRow[]>> {
  const grouped = new Map<string, PlatformMarketRow[]>();
  if (marketIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(platformMarkets)
    .where(inArray(platformMarkets.marketId, marketIds));
  for (const row of rows) {
    const list = grouped.get(row.marketId);
    if (list) list.push(row);
    else grouped.set(row.marketId, [row]);
  }
  return grouped;
}

async function loadTags(
  db: ReturnType<typeof getDb>,
  marketIds: string[],
): Promise<Map<string, TagRow[]>> {
  const grouped = new Map<string, TagRow[]>();
  if (marketIds.length === 0) return grouped;
  const rows = await db
    .select({ marketId: marketTags.marketId, tag: tags })
    .from(marketTags)
    .innerJoin(tags, eq(marketTags.tagSlug, tags.slug))
    .where(inArray(marketTags.marketId, marketIds));
  for (const row of rows) {
    const list = grouped.get(row.marketId);
    if (list) list.push(row.tag);
    else grouped.set(row.marketId, [row.tag]);
  }
  return grouped;
}

// --------------------------------------------------------------------------- //
// WHERE-clause builder shared by markets / homeMarkets
// --------------------------------------------------------------------------- //

function buildWhere(args: {
  search?: string | null;
  filterInput?: MarketFiltersInput | null;
  marketIds?: string[] | null;
  status?: string | null;
}): SQL | undefined {
  const conditions: SQL[] = [];

  if (args.search) {
    conditions.push(ilike(markets.question, `%${args.search}%`));
  }

  if (args.marketIds && args.marketIds.length > 0) {
    conditions.push(inArray(markets.id, args.marketIds));
  }

  // homeMarkets passes a top-level status arg.
  if (args.status) {
    conditions.push(eq(markets.status, args.status));
  }

  const f = args.filterInput;
  if (f) {
    if (f.status) {
      conditions.push(eq(markets.status, f.status));
    }
    if (f.platforms && f.platforms.length > 0) {
      conditions.push(inArray(markets.platform, f.platforms));
    }
    if (f.includedTags && f.includedTags.length > 0) {
      conditions.push(
        inArray(
          markets.id,
          getDb()
            .select({ id: marketTags.marketId })
            .from(marketTags)
            .where(inArray(marketTags.tagSlug, f.includedTags)),
        ),
      );
    }
    if (f.excludedTags && f.excludedTags.length > 0) {
      const sub = getDb()
        .select({ id: marketTags.marketId })
        .from(marketTags)
        .where(inArray(marketTags.tagSlug, f.excludedTags));
      conditions.push(sql`${markets.id} NOT IN ${sub}`);
    }
    if (f.volume24hMin !== null && f.volume24hMin !== undefined) {
      conditions.push(
        gte(markets.volume24hMicro, dollarsFloatToMicroBigint(f.volume24hMin)),
      );
    }
    if (f.liquidityMin !== null && f.liquidityMin !== undefined) {
      conditions.push(
        gte(markets.liquidityMicro, dollarsFloatToMicroBigint(f.liquidityMin)),
      );
    }
    if (f.endDateMin !== null && f.endDateMin !== undefined) {
      conditions.push(gte(markets.endDate, new Date(f.endDateMin * 1000)));
    }
    if (f.endDateMax !== null && f.endDateMax !== undefined) {
      conditions.push(lte(markets.endDate, new Date(f.endDateMax * 1000)));
    }

    const hasProbMin = f.probabilityMin !== null && f.probabilityMin !== undefined;
    const hasProbMax = f.probabilityMax !== null && f.probabilityMax !== undefined;
    if (hasProbMin || hasProbMax) {
      const probConds: SQL[] = [eq(marketOutcomes.isPrimary, true)];
      if (hasProbMin) {
        probConds.push(
          gte(marketOutcomes.midpointMicro, BigInt(Math.round(f.probabilityMin! * 1e6))),
        );
      }
      if (hasProbMax) {
        probConds.push(
          lte(marketOutcomes.midpointMicro, BigInt(Math.round(f.probabilityMax! * 1e6))),
        );
      }
      conditions.push(
        inArray(
          markets.id,
          getDb()
            .select({ id: marketOutcomes.marketId })
            .from(marketOutcomes)
            .where(and(...probConds)),
        ),
      );
    }
    // bookmarked, withPosition, spreadMin/Max intentionally ignored (no data yet).
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

function orderByClause(sortBy?: string | null, sortOrder?: string | null) {
  const dir = sortOrder === "asc" ? asc : desc;
  switch (sortBy) {
    case "volume24h":
      return dir(markets.volume24hMicro);
    case "liquidity":
      return dir(markets.liquidityMicro);
    case "endDate":
      return dir(markets.endDate);
    case "volume":
    default:
      return dir(markets.volumeMicro);
  }
}

// --------------------------------------------------------------------------- //
// Core: fetch a filtered page + assemble MarketItemListEntry[]
// --------------------------------------------------------------------------- //

async function fetchMarketConnection(opts: {
  where: SQL | undefined;
  orderBy: ReturnType<typeof orderByClause>;
  limit: number;
  offset: number;
}) {
  const db = getDb();

  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(markets)
    .where(opts.where);

  const rows = await db
    .select()
    .from(markets)
    .where(opts.where)
    .orderBy(opts.orderBy)
    .limit(opts.limit)
    .offset(opts.offset);

  const ids = rows.map((r) => r.id);
  const [outcomesByMarket, platformMarketsByMarket, tagsByMarket] = await Promise.all([
    loadOutcomes(db, ids),
    loadPlatformMarkets(db, ids),
    loadTags(db, ids),
  ]);

  const data = rows.map((m) =>
    shapeListEntry(m, outcomesByMarket, platformMarketsByMarket, tagsByMarket),
  );

  return {
    data,
    hasMore: opts.offset + rows.length < total,
    total,
  };
}

// --------------------------------------------------------------------------- //
// Public resolvers
// --------------------------------------------------------------------------- //

export async function resolveMarkets(args: MarketsArgs) {
  const limit = args.limit ?? 100;
  const offset = args.offset ?? 0;
  const where = buildWhere({
    search: args.search,
    filterInput: args.filterInput,
    marketIds: args.marketIds,
  });
  return fetchMarketConnection({
    where,
    orderBy: orderByClause(args.sortBy, args.sortOrder),
    limit,
    offset,
  });
}

export async function resolveHomeMarkets(args: HomeMarketsArgs) {
  const limit = args.limit ?? 100;
  const where = buildWhere({
    filterInput: args.filterInput,
    status: args.status,
  });
  return fetchMarketConnection({
    where,
    orderBy: orderByClause(args.sortBy, "desc"),
    limit,
    offset: 0,
  });
}

export async function resolveMarket(args: MarketArgs) {
  const db = getDb();
  let row: MarketRow | undefined;
  if (args.id) {
    [row] = await db.select().from(markets).where(eq(markets.id, args.id)).limit(1);
  }
  if (!row && args.slug) {
    [row] = await db.select().from(markets).where(eq(markets.slug, args.slug)).limit(1);
  }
  if (!row) return null;

  const [outcomeRows, platformMarketRows] = await Promise.all([
    db.select().from(marketOutcomes).where(eq(marketOutcomes.marketId, row.id)),
    db.select().from(platformMarkets).where(eq(platformMarkets.marketId, row.id)),
  ]);

  return {
    id: row.id,
    eventId: row.eventId,
    question: row.question,
    displayNameShort: row.displayNameShort,
    description: row.description,
    status: row.status,
    volume: micro(row.volumeMicro),
    liquidity: micro(row.liquidityMicro),
    totalOpenInterest: micro(row.totalOpenInterestMicro),
    totalVolume: micro(row.totalVolumeMicro),
    combinedLiquidity: micro(row.combinedLiquidityMicro),
    icon: row.icon,
    startDate: row.startDate,
    endDate: row.endDate,
    resolutionDate: row.resolutionDate,
    slug: row.slug,
    platform: row.platform,
    outcomes: outcomeRows.map(shapeOutcome),
    platformMarkets: platformMarketRows.map(shapePlatformMarket),
    netFlowVolumes: {
      volume1hMicrodollars: micro(row.volume1hMicro),
      volume24hMicrodollars: micro(row.volume24hMicro),
      volume1hChangePct: row.volume1hChangePct,
      volume24hChangePct: row.volume24hChangePct,
    },
  };
}

export async function resolveEvent(args: EventArgs) {
  const db = getDb();
  const [row] = await db.select().from(events).where(eq(events.id, args.id)).limit(1);
  if (!row) return null;

  const [marketRows, platformEventRows] = await Promise.all([
    db.select().from(markets).where(eq(markets.eventId, row.id)),
    db.select().from(platformEvents).where(eq(platformEvents.eventId, row.id)),
  ]);

  const marketIds = marketRows.map((m) => m.id);
  const [outcomesByMarket, platformMarketsByMarket] = await Promise.all([
    loadOutcomes(db, marketIds),
    loadPlatformMarkets(db, marketIds),
  ]);

  return {
    id: row.id,
    title: row.title,
    totalVolume: micro(row.totalVolumeMicro),
    combinedLiquidity: micro(row.combinedLiquidityMicro),
    earliestResolutionDate: row.earliestResolutionDate,
    platformEvents: platformEventRows.map((pe) => ({
      id: pe.id,
      platform: pe.platform,
      imageUrl: pe.imageUrl,
    })),
    markets: marketRows.map((m) => ({
      id: m.id,
      eventId: m.eventId,
      question: m.question,
      displayNameShort: m.displayNameShort,
      description: m.description,
      status: m.status,
      volume: micro(m.volumeMicro),
      liquidity: micro(m.liquidityMicro),
      totalOpenInterest: micro(m.totalOpenInterestMicro),
      totalVolume: micro(m.totalVolumeMicro),
      combinedLiquidity: micro(m.combinedLiquidityMicro),
      icon: m.icon,
      startDate: m.startDate,
      endDate: m.endDate,
      resolutionDate: m.resolutionDate,
      slug: m.slug,
      platform: m.platform,
      outcomes: (outcomesByMarket.get(m.id) ?? []).map(shapeOutcome),
      platformMarkets: (platformMarketsByMarket.get(m.id) ?? []).map(shapePlatformMarket),
      netFlowVolumes: {
        volume1hMicrodollars: micro(m.volume1hMicro),
        volume24hMicrodollars: micro(m.volume24hMicro),
        volume1hChangePct: m.volume1hChangePct,
        volume24hChangePct: m.volume24hChangePct,
      },
    })),
  };
}

export async function resolveTags(args: TagsArgs) {
  const db = getDb();
  const conditions: SQL[] = [];
  if (args.search) {
    conditions.push(ilike(tags.label, `%${args.search}%`));
  }
  if (args.requiredSlugs && args.requiredSlugs.length > 0) {
    conditions.push(inArray(tags.slug, args.requiredSlugs));
  }
  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const rows = await db
    .select()
    .from(tags)
    .where(where)
    .orderBy(sql`${tags.activeMarketCount} DESC NULLS LAST`)
    .limit(200);

  return rows.map(shapeTag);
}
