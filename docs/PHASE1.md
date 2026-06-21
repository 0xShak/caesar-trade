# Caesar Terminal — Phase 1 summary (read-only terminal)

**Status: ✅ COMPLETE (core)** · date 2026-06-22 · monorepo at `/root/caesar`

Phase 1 goal (bible §13): real ingesters → normalized Postgres (microdollars) →
resolvers replace fixtures → markets browser + market detail. Done, end-to-end, on
**public read APIs only** (no credentials, no mainnet, no real funds).

## What was built

### `packages/db` — normalized store (Drizzle + Postgres)
- 8 tables: `events`, `platform_events`, `markets`, `platform_markets`,
  `market_outcomes`, `tags`, `market_tags`, `sync_state`. Mirrors the GraphQL SDL.
- **Money discipline:** every monetary/price column is a Postgres `bigint` in
  **microdollars** (surfaced as JS `bigint` via drizzle `mode:"bigint"`). Prices/
  probabilities live in `0..1e6` (probability = micro/1e6). Rates/percentages
  (`feeRate`, `*_change_pct`, `apy`) stay `real`; `fee_rate_bps` stays `integer`.
- Deterministic canonical ids → idempotent upserts: `markets.id = "<platform>:<externalId>"`
  (Polymarket conditionId | Kalshi ticker). Migration generated + applied; client is a
  lazy node-postgres pool. `pnpm --filter @caesar/db db:generate|db:migrate`.

### `apps/ingest` — venue ingesters → normalized Postgres
- Shared contract `src/normalize.ts`: the venue-agnostic `NormBundle` shape +
  `upsertBundles()` (one transaction per market: event → market → platform_market →
  outcomes → tags), `recomputeTagCounts()`, `recordSync()`. Producers MUST pass
  microdollar `bigint`s (via `@caesar/money`); the upsert never does float math.
- **Polymarket** (`src/polymarket.ts`): gamma `/events?with nested markets`, keyset by
  `offset`, maps conditionId→externalId, `clobTokenIds`→externalOutcomeId,
  `outcomePrices`→midpoint micro, `orderPriceMinTickSize`/`orderMinSize`→tick/min micro.
- **Kalshi** (`src/kalshi.ts`): `/events?with_nested_markets`, cursor pagination,
  series/event/market collapsed; dollar-string prices → micro; yes/no legs as two
  outcomes; `category`→tag. (Public data — no auth.)
- Runner `src/run.ts`: `--once` (single pass) or poll loop (60s). Per-venue isolation;
  failures recorded in `sync_state`, never abort the other venue.
- **Live run verified:** 4043 Polymarket + 691 Kalshi markets ingested; prices in
  `0..1e6`, volumes match gamma (e.g. USA-WC $92.4M), tick 0.001/0.01, min $5/$1.

### `apps/api` — resolvers replace fixtures (SDL unchanged)
- `markets`, `homeMarkets`, `market`, `event`, `tags` now read Postgres via `@caesar/db`
  (Drizzle). `health` + `me` stub kept. All other root fields still resolve null.
- **Wire-money contract:** amount Floats = microdollars (`Number(bigint)`); `midPoint`/
  `spread` = probability `0..1` (micro/1e6) with `*Microdollars` siblings = micro;
  `tickSize`/`minimumOrderSize` = micro/1e6; `feeRate`/pct pass through.
- `MarketFiltersInput` honored: status, platforms, included/excludedTags (subquery),
  volume24hMin, liquidityMin, endDateMin/Max, probabilityMin/Max (primary-outcome
  midpoint). Search ILIKE on question. Sort volume/volume24h/liquidity/endDate.
  Outcomes/platformMarkets/tags batched per page (no N+1).

### `apps/web` — markets browser + market detail
- **Markets browser:** control bar (debounced search, platform filter, sort + asc/desc,
  clickable tag chips), **URL-synced** via `useSearchParams` (shareable/reload-safe),
  offset pagination (page 50), rows link to detail. Reuses the dark-mono CSS system.
- **Market detail** (`/markets/:id`): header + stats strip (volume/liquidity/OI),
  outcomes table (mid ¢, spread, result), platform-markets panel (tick, min, fee, negRisk).
- Shared `lib/money.ts` formatters over `@caesar/money`.

## Verification (all green)
| Gate | Result |
|---|---|
| `pnpm typecheck` (8 packages) | ✅ all clean |
| Drizzle migration apply | ✅ 8 tables |
| Live ingest one-shot | ✅ 4043 poly + 691 kalshi, both `sync_state=ok` |
| GraphQL `markets` (filter+sort+tags) | ✅ real data, correct micro conversions |
| GraphQL `market(id)` detail | ✅ outcomes/tick/negRisk/netFlow correct |
| GraphQL `tags(search)` | ✅ with activeMarketCount |
| web production build | ✅ (3MB Privy/walletconnect chunk pre-existing, split later) |

## Notes / minor debt
- **Kalshi volume proxy:** `volume_fp`/`open_interest_fp` are *contract counts*; treated
  as $1-notional microdollars as a coarse cross-venue volume proxy (flagged in code).
  Revisit if a true dollar-volume source is needed.
- **Spread:** Polymarket gamma gives no spread → outcome `spreadMicro` null (CLOB
  orderbook enrichment is a later phase); Kalshi spread derived from bid/ask.
- Resolved/closed markets are filtered at ingest (`closed=false`/`status=open`), so
  `result` is null for the live set.
- No cross-venue Event unification yet (events are per-platform) — a later-phase concern.
- Ingester currently run manually/loop; a scheduled worker (Temporal/cron) is Phase 3 infra.

## Run it
```bash
pnpm infra:up
pnpm --filter @caesar/db db:migrate
pnpm --filter @caesar/ingest ingest:once     # populate Postgres (~3 min for 400 events/venue)
pnpm --filter @caesar/api dev                # GraphQL :4000
pnpm --filter @caesar/web dev                # SPA :3000  → /markets
```

## Next
**Phase 2 (identity/wallet)** core is **blocked** on user secrets (`PRIVY_APP_ID/SECRET`)
+ a confirmed Amoy CLOB endpoint — only the non-secret surface is scaffoldable.
**Phase 4 (realtime: subscriptions + WS)** is fully buildable without secrets and is the
next autonomous target. See `docs/NIGHT-SESSION-LOG.md`.
