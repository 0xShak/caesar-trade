# Caesar Terminal — Phase 4 summary (realtime: subscriptions over WebSocket)

**Status: ✅ COMPLETE (core)** · date 2026-06-22 · built on public APIs, no credentials.

Phase 4 goal (bible §13): live market data via GraphQL subscriptions. Built the
transport + the trades/stats streams end-to-end; deeper streams (notifications,
tracked-trader feed) are inert placeholders until their owning phases.

## Server (`apps/api`)
- **Transport:** `graphql-ws@6` `WebSocketServer` (ws@8) attached to Fastify's underlying
  Node server at `ws://localhost:4000/graphql` (`server.ts`). This is **separate** from the
  buffered HTTP query bridge — HTTP `POST /graphql` keeps serving queries/mutations; WS
  `Upgrade` requests on the same path serve subscriptions. Reuses the same executable
  `schema`.
- **Subscription resolvers** (`resolvers/subscriptions.ts`), async-generator shape
  `{ subscribe, resolve }`:
  - `marketTrades(marketId)` / `multiMarketTrades(marketIds)` — poll the public venue
    trade APIs via the **already-verified** `resolveMarketRecentTrades`, prime a seen-set
    on first poll (no backfill spam), then emit only trades arriving after subscribe
    (~3s cadence, deduped by trade key, oldest-first).
  - `marketStats(marketId)` — reads the primary-outcome midpoint from Postgres (~5s),
    emits a `MarketOutcome` only when the midpoint changes.
  - `trackedTraderTrades`, `userNotifications` — never-emitting placeholders (Phase 2/5).

## Client (`apps/web`)
- `lib/apollo.ts`: `graphql-ws` `GraphQLWsLink` + Apollo `split()` — subscription ops go
  over WS (through the existing Vite `ws:true` proxy on `/graphql`), queries/mutations stay
  on the HTTP chain. Auth tokens forwarded via `connectionParams` (ready for Phase 2).
- `MarketDetailPage`: `GetMarketTrades` backfills the tape; the `MarketTrades` subscription
  prepends new trades (dedupe by tx hash, cap 50) with a `● live` pill + new-row flash.

## Verification
| Check | Result |
|---|---|
| `pnpm --filter @caesar/api typecheck` | ✅ |
| WS subscribe handshake (`graphql-ws` client) | ✅ connects, stays open, no errors |
| `marketStats` end-to-end yield | ✅ **deterministic**: emitted initial midpoint, then a forced DB midpoint change streamed through within the poll window |
| `marketTrades` | ✅ pipeline verified; emits when markets actively trade (feed was globally quiet at test time — 0 fresh trades platform-wide in a 12s window) |
| web typecheck + production build | ✅ |

## Notes / debt
- In-process polling (no Redis fan-out yet) — fine for single-node dev; Redis pub/sub +
  worker fleet is Phase 3 scale.
- Poll cadence (3s trades / 5s stats) is a placeholder; a true CLOB WS firehose
  (`wss://ws-subscriptions-clob.polymarket.com`) is a later optimization.
- `marketStats` reads the DB midpoint, so it only changes as the ingester re-polls; run the
  ingester loop (`pnpm --filter @caesar/ingest ingest`) to see it move on live data.
