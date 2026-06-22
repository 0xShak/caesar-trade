# Parallel work — Track A (Phase 3) vs Track B (read-only depth/infra)

Two Claude sessions run concurrently in **separate git worktrees** so they never
touch the same files on disk:

| | Track B (main session) | Track A (Phase 3) |
|---|---|---|
| Working dir | `/root/caesar` | `/root/caesar-phase3` |
| Branch | `main` (or a `track-b` branch) | `phase3-trading` |
| Scope | Phase 2 live-verify + read-only depth & infra | Phase 3 trading, built OFFLINE + unit-tested |

Shared infra (Postgres :55432 / Redis :56379) is fine: Track A does **no DB
writes/migrations**, Track B may migrate.

## File ownership (keep disjoint)

**Track A (Phase 3) owns / may edit:**
- `packages/chain/src/orders.ts` (NEW) + `*.test.ts` — order construction/signing
- `packages/chain/src/eip712.ts`, `clients.ts` — may extend (Track B never touches these)
- `apps/api/src/resolvers/orders.ts` (NEW) — placeOrder/cancelOrder plumbing
- **MUST NOT touch:** `packages/graphql-schema/src/schema.graphql` (placeOrder/cancelOrder
  already exist in the SDL — no change needed), `packages/db/**` (no migrations — keep order
  state CLOB-backed, not Postgres), `apps/ingest/**`, `apps/web/**` (defer the order ticket UI;
  if unavoidable, only NEW components — never `MarketDetailPage.tsx`/`index.css`),
  `apps/web/vite.config.ts`.

**Track B owns / may edit:**
- `apps/api/src/resolvers/orderbook.ts` (NEW) + `subscriptions.ts` (orderbook WS)
- `apps/web/src/components/*` (NEW, e.g. OrderBook), `MarketDetailPage.tsx`, `index.css`, `vite.config.ts`
- `packages/graphql-schema/src/schema.graphql` (orderbook fields), `apps/ingest/**`,
  `packages/db/src/schema.ts` + migrations (event unification)

## The ONE shared file
`apps/api/src/resolvers/index.ts` — both add to the resolver map (Track A → `Mutation`,
Track B → `Query`/`Subscription`). Different keys/lines → a trivial 3-way merge. Each track:
keep additions localized; import your resolvers from your own module.

## Merge plan
1. Commit often on each branch; push.
2. When a track finishes: from `/root/caesar`, `git merge phase3-trading` (or open a PR).
   Expect at most a one-spot merge in `resolvers/index.ts`.
3. Tear down the worktree when done: `git worktree remove /root/caesar-phase3`.
