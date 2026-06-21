/**
 * Caesar normalized store (Phase 1).
 *
 * The unified shape mirrors the GraphQL SDL (`@caesar/graphql-schema`): a
 * canonical `markets` row aggregates one-or-more `platform_markets` (one per
 * venue) and `market_outcomes` (the shared YES/NO… legs). Polymarket and Kalshi
 * both normalize INTO these tables at ingest.
 *
 * Money discipline (bible §1/§7/§12): every monetary/price column is stored as
 * **microdollars** — integer USD × 1e6 in a Postgres `bigint`, surfaced as JS
 * `bigint` (drizzle `mode: "bigint"`). Prices/probabilities live in 0..1e6
 * (probability = price / 1e6). Rates/percentages (feeRate, *_change_pct, apy)
 * are NOT money and stay as `real`. fee_rate_bps stays an integer (basis points).
 *
 * Identifier bridges:
 *   markets.id              internal canonical id (e.g. "poly:<conditionId>")
 *   platform_markets.external_id   Polymarket conditionId | Kalshi market ticker
 *   market_outcomes.external_outcome_id  Polymarket clobTokenId | Kalshi "yes"/"no"
 */
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  real,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Reusable column builders ----------------------------------------------------
const microAmount = (name: string) => bigint(name, { mode: "bigint" });
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

// --------------------------------------------------------------------------- //
// Events (Event / PlatformEvent)
// --------------------------------------------------------------------------- //

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  title: text("title"),
  totalVolumeMicro: microAmount("total_volume_micro"),
  combinedLiquidityMicro: microAmount("combined_liquidity_micro"),
  earliestResolutionDate: timestamp("earliest_resolution_date", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const platformEvents = pgTable(
  "platform_events",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'polymarket' | 'kalshi'
    externalId: text("external_id").notNull(),
    imageUrl: text("image_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("platform_events_platform_external_uq").on(t.platform, t.externalId),
    index("platform_events_event_idx").on(t.eventId),
  ],
);

// --------------------------------------------------------------------------- //
// Markets (canonical) + PlatformMarket (per-venue)
// --------------------------------------------------------------------------- //

export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    question: text("question"),
    displayNameShort: text("display_name_short"),
    eventTitle: text("event_title"),
    description: text("description"),
    status: text("status"), // MarketStatus: active|LIVE|OPEN|CLOSED|RESOLVED|PENDING|MATCHED
    slug: text("slug"),
    platform: text("platform"), // primary platform when a market is sole-venue
    icon: text("icon"),
    startDate: timestamp("start_date", { withTimezone: true, mode: "date" }),
    endDate: timestamp("end_date", { withTimezone: true, mode: "date" }),
    resolutionDate: timestamp("resolution_date", { withTimezone: true, mode: "date" }),

    // Money (microdollars)
    volumeMicro: microAmount("volume_micro"),
    liquidityMicro: microAmount("liquidity_micro"),
    totalOpenInterestMicro: microAmount("total_open_interest_micro"),
    totalVolumeMicro: microAmount("total_volume_micro"),
    combinedLiquidityMicro: microAmount("combined_liquidity_micro"),
    volume1hMicro: microAmount("volume_1h_micro"),
    volume24hMicro: microAmount("volume_24h_micro"),
    priceChange1hMicro: microAmount("price_change_1h_micro"),
    priceChange24hMicro: microAmount("price_change_24h_micro"),

    // Rates / percentages (NOT money)
    volume1hChangePct: real("volume_1h_change_pct"),
    volume24hChangePct: real("volume_24h_change_pct"),
    priceChange1hPct: real("price_change_1h_pct"),
    priceChange24hPct: real("price_change_24h_pct"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("markets_platform_idx").on(t.platform),
    index("markets_status_idx").on(t.status),
    index("markets_event_idx").on(t.eventId),
    index("markets_end_date_idx").on(t.endDate),
    index("markets_volume_idx").on(t.volumeMicro),
    index("markets_slug_idx").on(t.slug),
  ],
);

export const platformMarkets = pgTable(
  "platform_markets",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // Polymarket conditionId | Kalshi ticker
    platform: text("platform").notNull(),
    platformSlug: text("platform_slug"),
    question: text("question"),
    displayNameShort: text("display_name_short"),
    eventTitle: text("event_title"),
    imageUrl: text("image_url"),
    icon: text("icon"),
    endDate: timestamp("end_date", { withTimezone: true, mode: "date" }),

    tickSizeMicro: microAmount("tick_size_micro"), // 0.01 → 10_000
    minimumOrderSizeMicro: microAmount("minimum_order_size_micro"), // 5 USDC → 5_000_000
    feeRateBps: integer("fee_rate_bps"),
    feeRate: real("fee_rate"),
    negRisk: boolean("neg_risk"),
    priceChange24hMicro: microAmount("price_change_24h_micro"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("platform_markets_platform_external_uq").on(t.platform, t.externalId),
    index("platform_markets_market_idx").on(t.marketId),
  ],
);

export const marketOutcomes = pgTable(
  "market_outcomes",
  {
    outcomeId: text("outcome_id").primaryKey(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    platformMarketId: text("platform_market_id").references(() => platformMarkets.id, {
      onDelete: "cascade",
    }),
    externalOutcomeId: text("external_outcome_id"), // Polymarket clobTokenId | Kalshi yes/no
    outcomeName: text("outcome_name"),
    isPrimary: boolean("is_primary"),
    outcomeIndex: integer("outcome_index"),
    midpointMicro: microAmount("midpoint_micro"), // price 0..1e6
    spreadMicro: microAmount("spread_micro"),
    result: text("result"), // OutcomeResult: YES|NO|null
    apy: real("apy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("market_outcomes_market_idx").on(t.marketId),
    index("market_outcomes_platform_market_idx").on(t.platformMarketId),
    uniqueIndex("market_outcomes_pm_external_uq").on(t.platformMarketId, t.externalOutcomeId),
  ],
);

// --------------------------------------------------------------------------- //
// Tags
// --------------------------------------------------------------------------- //

export const tags = pgTable("tags", {
  slug: text("slug").primaryKey(),
  label: text("label"),
  activeMarketCount: integer("active_market_count"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const marketTags = pgTable(
  "market_tags",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    tagSlug: text("tag_slug")
      .notNull()
      .references(() => tags.slug, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.marketId, t.tagSlug] }),
    index("market_tags_tag_idx").on(t.tagSlug),
  ],
);

// --------------------------------------------------------------------------- //
// Ingest bookkeeping
// --------------------------------------------------------------------------- //

export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(), // e.g. 'polymarket:markets', 'kalshi:markets'
  cursor: text("cursor"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
  lastRunStatus: text("last_run_status"), // 'ok' | 'error'
  note: text("note"),
  updatedAt: updatedAt(),
});

// Convenience type exports ----------------------------------------------------
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type MarketRow = typeof markets.$inferSelect;
export type NewMarketRow = typeof markets.$inferInsert;
export type PlatformMarketRow = typeof platformMarkets.$inferSelect;
export type NewPlatformMarketRow = typeof platformMarkets.$inferInsert;
export type MarketOutcomeRow = typeof marketOutcomes.$inferSelect;
export type NewMarketOutcomeRow = typeof marketOutcomes.$inferInsert;
export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;
