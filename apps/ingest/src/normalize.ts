/**
 * Shared normalization contract for all ingesters.
 *
 * Every venue ingester (Polymarket, Kalshi) maps its raw API payloads into
 * `NormBundle[]` — a venue-agnostic shape that mirrors the GraphQL SDL — and
 * hands them to `upsertBundles()`, which performs the idempotent write into the
 * normalized Postgres store (@caesar/db).
 *
 * Money rule: producers MUST pass microdollar `bigint`s already. Use
 * `@caesar/money` (`dollarsToMicro`, `centsToMicro`, `probabilityToMicro`) to
 * convert — never hand-roll float math. `null` means "unknown", stored as NULL.
 *
 * Idempotency: canonical ids are deterministic functions of (platform,
 * externalId), so re-ingesting the same market UPSERTs in place.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@caesar/db";
import {
  events,
  platformEvents,
  markets,
  platformMarkets,
  marketOutcomes,
  tags as tagsTable,
  marketTags,
  syncState,
} from "@caesar/db";

export type Platform = "polymarket" | "kalshi";

export interface NormOutcome {
  externalOutcomeId: string;
  outcomeName: string | null;
  isPrimary: boolean;
  outcomeIndex: number;
  /** price 0..1e6 microdollars (probability = micro / 1e6) */
  midpointMicro: bigint | null;
  spreadMicro: bigint | null;
  result: "YES" | "NO" | null;
}

export interface NormTag {
  slug: string;
  label: string | null;
}

export interface NormBundle {
  platform: Platform;

  // Event (per-venue grouping; cross-venue unification is a later phase)
  eventExternalId: string | null;
  eventTitle: string | null;
  eventImageUrl: string | null;
  eventVolumeMicro: bigint | null;
  eventLiquidityMicro: bigint | null;
  earliestResolutionDate: Date | null;

  // Market (canonical) + the single platform market for this venue
  externalId: string; // Polymarket conditionId | Kalshi market ticker
  platformSlug: string | null;
  question: string | null;
  displayNameShort: string | null;
  description: string | null;
  status: string | null;
  slug: string | null;
  icon: string | null;
  imageUrl: string | null;
  startDate: Date | null;
  endDate: Date | null;
  resolutionDate: Date | null;

  volumeMicro: bigint | null;
  liquidityMicro: bigint | null;
  totalOpenInterestMicro: bigint | null;
  volume24hMicro: bigint | null;
  volume24hChangePct: number | null;

  tickSizeMicro: bigint | null;
  minimumOrderSizeMicro: bigint | null;
  feeRateBps: number | null;
  feeRate: number | null;
  negRisk: boolean | null;

  tags: NormTag[];
  outcomes: NormOutcome[];
}

// Deterministic canonical ids -------------------------------------------------
export const ids = {
  event: (p: Platform, ext: string) => `${p}:evt:${ext}`,
  market: (p: Platform, ext: string) => `${p}:${ext}`,
  platformMarket: (p: Platform, ext: string) => `${p}:pm:${ext}`,
  platformEvent: (p: Platform, ext: string) => `${p}:pe:${ext}`,
  outcome: (p: Platform, ext: string, idx: number) => `${p}:out:${ext}:${idx}`,
};

const now = () => new Date();

/**
 * Idempotently upsert a batch of normalized bundles. Each bundle writes its
 * event (if any), market, platform_market, outcomes, and tags. Runs inside one
 * transaction so a market and its outcomes are never partially visible.
 */
export async function upsertBundles(db: Db, bundles: NormBundle[]): Promise<void> {
  for (const b of bundles) {
    const p = b.platform;
    const marketId = ids.market(p, b.externalId);
    const platformMarketId = ids.platformMarket(p, b.externalId);
    const eventId = b.eventExternalId ? ids.event(p, b.eventExternalId) : null;

    await db.transaction(async (tx) => {
      // Event + platform_event
      if (eventId && b.eventExternalId) {
        await tx
          .insert(events)
          .values({
            id: eventId,
            title: b.eventTitle,
            totalVolumeMicro: b.eventVolumeMicro,
            combinedLiquidityMicro: b.eventLiquidityMicro,
            earliestResolutionDate: b.earliestResolutionDate,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: events.id,
            set: {
              title: b.eventTitle,
              totalVolumeMicro: b.eventVolumeMicro,
              combinedLiquidityMicro: b.eventLiquidityMicro,
              earliestResolutionDate: b.earliestResolutionDate,
              updatedAt: now(),
            },
          });

        await tx
          .insert(platformEvents)
          .values({
            id: ids.platformEvent(p, b.eventExternalId),
            eventId,
            platform: p,
            externalId: b.eventExternalId,
            imageUrl: b.eventImageUrl,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: [platformEvents.platform, platformEvents.externalId],
            set: { imageUrl: b.eventImageUrl, eventId, updatedAt: now() },
          });
      }

      // Market (canonical)
      const marketValues = {
        id: marketId,
        eventId,
        question: b.question,
        displayNameShort: b.displayNameShort,
        eventTitle: b.eventTitle,
        description: b.description,
        status: b.status,
        slug: b.slug,
        platform: p,
        icon: b.icon ?? b.imageUrl,
        startDate: b.startDate,
        endDate: b.endDate,
        resolutionDate: b.resolutionDate,
        volumeMicro: b.volumeMicro,
        liquidityMicro: b.liquidityMicro,
        totalOpenInterestMicro: b.totalOpenInterestMicro,
        totalVolumeMicro: b.volumeMicro,
        combinedLiquidityMicro: b.liquidityMicro,
        volume24hMicro: b.volume24hMicro,
        volume24hChangePct: b.volume24hChangePct,
        updatedAt: now(),
        lastSyncedAt: now(),
      };
      await tx
        .insert(markets)
        .values(marketValues)
        .onConflictDoUpdate({
          target: markets.id,
          set: { ...marketValues, id: undefined },
        });

      // Platform market
      const pmValues = {
        id: platformMarketId,
        marketId,
        externalId: b.externalId,
        platform: p,
        platformSlug: b.platformSlug ?? b.slug,
        question: b.question,
        displayNameShort: b.displayNameShort,
        eventTitle: b.eventTitle,
        imageUrl: b.imageUrl ?? b.icon,
        icon: b.icon,
        endDate: b.endDate,
        tickSizeMicro: b.tickSizeMicro,
        minimumOrderSizeMicro: b.minimumOrderSizeMicro,
        feeRateBps: b.feeRateBps,
        feeRate: b.feeRate,
        negRisk: b.negRisk,
        updatedAt: now(),
      };
      await tx
        .insert(platformMarkets)
        .values(pmValues)
        .onConflictDoUpdate({
          target: [platformMarkets.platform, platformMarkets.externalId],
          set: { ...pmValues, id: undefined },
        });

      // Outcomes
      for (const o of b.outcomes) {
        const outcomeId = ids.outcome(p, b.externalId, o.outcomeIndex);
        const oValues = {
          outcomeId,
          marketId,
          platformMarketId,
          externalOutcomeId: o.externalOutcomeId,
          outcomeName: o.outcomeName,
          isPrimary: o.isPrimary,
          outcomeIndex: o.outcomeIndex,
          midpointMicro: o.midpointMicro,
          spreadMicro: o.spreadMicro,
          result: o.result,
          updatedAt: now(),
        };
        await tx
          .insert(marketOutcomes)
          .values(oValues)
          .onConflictDoUpdate({
            target: marketOutcomes.outcomeId,
            set: { ...oValues, outcomeId: undefined },
          });
      }

      // Tags + market_tags
      for (const t of b.tags) {
        if (!t.slug) continue;
        await tx
          .insert(tagsTable)
          .values({ slug: t.slug, label: t.label, updatedAt: now() })
          .onConflictDoUpdate({ target: tagsTable.slug, set: { label: t.label, updatedAt: now() } });
        await tx
          .insert(marketTags)
          .values({ marketId, tagSlug: t.slug })
          .onConflictDoNothing();
      }
    });
  }
}

/** Recompute tags.active_market_count from current market_tags membership. */
export async function recomputeTagCounts(db: Db): Promise<void> {
  await db.execute(sql`
    UPDATE tags t SET active_market_count = sub.cnt
    FROM (
      SELECT mt.tag_slug, COUNT(*)::int AS cnt
      FROM market_tags mt
      JOIN markets m ON m.id = mt.market_id
      GROUP BY mt.tag_slug
    ) sub
    WHERE t.slug = sub.tag_slug
  `);
}

/** Record an ingester run outcome in sync_state. */
export async function recordSync(
  db: Db,
  key: string,
  status: "ok" | "error",
  note?: string,
): Promise<void> {
  await db
    .insert(syncState)
    .values({ key, lastSyncedAt: now(), lastRunStatus: status, note, updatedAt: now() })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { lastSyncedAt: now(), lastRunStatus: status, note, updatedAt: now() },
    });
}
