# Session summary — Phase 2 live-verify + orderbook depth

**Date:** 2026-06-22 · **Branch:** `main` (local commits, not pushed) ·
**Repo:** github.com/0xShak/caesar-trade

This session closed out the Phase 2 (identity & wallet) live round-trip and shipped
the first Track-B read-only-depth feature (live CLOB orderbook). It also folded in
the parallel Phase-3 trading branch. Below: what was done, where Caesar stands vs the
source of truth (`/root/Caesar-terminal.html`, the "bible"), and the critical path to
going live.

---

## 1. What we achieved this session

### A. Phase 2 login round-trip — verified LIVE (was never actually run before)
The Privy flow had been built but never rendered/authenticated end-to-end. Two latent
bugs surfaced on first real login and were fixed:

1. **Blank page** (`apps/web/vite.config.ts`, `main.tsx`) — Vite's `envDir` defaulted
   to `apps/web/`, so `VITE_PRIVY_APP_ID` (which lives only in the monorepo-root `.env`
   the API reads) was never inlined → empty appId → `PrivyProvider` threw at the top of
   the tree → blank `#root`. Fixed `envDir` to the repo root; added a fail-loud guard so
   an empty appId renders a visible error instead of a silent black screen.
2. **`me` always null** (`lib/apollo.ts`, `components/PrivyAuthBridge.tsx`) — `GetMe`
   fired the instant `authenticated` flipped, but the access token was cached
   asynchronously afterward and a refetch raced (throwing Apollo #43), so every request
   reached the server token-less. Fixed by resolving the token **per-request** in an
   async Apollo `setContext` link (+ async `graphql-ws` `connectionParams`) and
   registering the live getter during the bridge's render (it mounts before `<App>`, so
   the getter is set before `GetMe` dispatches).

**Verified live** (`thanhquangnguyen343@gmail.com`): token verifies
(`did:privy:cmqp9ayax…`) → `users` row created with embedded wallet
(`0xfA1Bc89F…`) + derived Safe `polymarketTradingAddress` (`0x2697C609…`) → ToS Accept
persists (`tos_accepted=t`, `v1.0`). Mainnet-gated flags stay false.

> Minor follow-up: Privy "identity tokens" are off in the dashboard, so
> `getEmbeddedWallet` uses the `getUserById` API path instead of the preferred local
> `idToken` decode. Works; enable identity tokens to drop the API call.

### B. Merged the parallel Phase-3 trading branch
`origin/phase3-trading` merged into `main` cleanly (commit `d20659d`): pure V2 order
construction in `@caesar/chain` (`orders.ts` + tests) and the `placeOrder`/`cancelOrder`
mutation plumbing (`resolvers/orders.ts`), all **mainnet-gated, no signing/submission**.
Chain tests now 30/30. (See `docs/PARALLEL-TRACKS.md`.)

### C. Live CLOB orderbook depth (Track B, fully shippable)
Replaced the single midpoint on the market-detail page with a real bid/ask depth ladder.
- **SDL** (Caesar extension): `Orderbook` / `OrderbookLevel`, `Query.marketOrderbook`,
  `Subscription.orderbookUpdates`. Level prices carried as `priceMicrodollars`
  (price 0..1 × 1e6), matching `market_outcomes.midpoint_micro`.
- **API**: `resolvers/orderbook.ts` fetches the public CLOB `/book` for the primary
  outcome's clobTokenId, maps→micro, sorts (bids desc / asks asc), derives mid/spread;
  never throws. `subscriptions.ts` polls `/book` @2s and emits on hash change (Polymarket
  only; Kalshi/closed/one-sided → graceful empty book).
- **Web**: `OrderBook.tsx` ladder (asks above mid, bids below, depth bars, mid/spread
  header, live pill) seeded by the snapshot query and replaced on each WS payload.

**Verified**: typecheck -r green; chain 30/30, money 11/11; web prod build OK; live
query maps a two-sided book correctly (mid 39500 = (2000+77000)/2, spread 75000);
subscription delivered snapshot + a hash-changed update over WS; public reads intact.

**Commits (local, unpushed):** `6e89948` login fix · `d20659d` phase3 merge ·
`4e5a296` orderbook · `95e06fd` ladder alignment.

---

## 2. Where we stand vs the source of truth (bible's 7 phases)

| Phase | Bible scope | Status |
|---|---|---|
| **0 — Foundations** | monorepo, infra, de-risk spikes | ✅ done |
| **1 — Read-only terminal** | markets browser, market detail, traders, price history | ✅ done (+ visx chart, **+ orderbook depth**) |
| **2 — Identity & wallet** | Privy login → `me` → onboarding gates → wallet setup | ✅ **login verified live**; wallet-setup logic built/tested, **execution mainnet-gated** |
| **3 — Trading** | sign+submit, order types, portfolio/PnL, claim, automations, order UI | ◑ **partial**: order construction + place/cancel plumbing built **offline & gated**; no real signing, no portfolio, no order-entry UI, no automations, no Kalshi trading |
| **4 — Realtime** | graphql-ws subs; raw WS firehose; client buffering | ✅ subs done (stats/trades/multi/**orderbook**); raw firehose still polled, no zustand/raf buffer |
| **5 — Differentiators** | multiview, counterparty, tracked-trader feed, signals, hubs/monitor/data/news, notifications, bookmarks | ✗ not started |
| **6 — Ops & polish** | admin, builder-fee accounting, analytics, geoblock/compliance, security review, perf/bundle-split | ✗ not started |

**SDL coverage (Parity contract is unchanged — the source of truth):** the read core
is wired (`markets`, `homeMarkets`, `market`, `event`, `tags`, `marketRecentTrades`,
`marketPositions`, `marketPriceHistory`, `marketOrderbook`, `traders`, `trader`,
`traderPositions`, `me`) plus 4 live subscriptions and the gated trading mutations
(`placeOrder`/`placeSplitOrder`/`placeMergeOrder`/`placeOrderBatch`/`cancelOrder`/
`cancelMarketOrders`, `syncTosFromPrivy`). The **large unimplemented surface**: portfolio
(`openPositions`/`closedPositions`/`portfolioStats`/`walletBalance`/`userOrders`/
`userTrades`), live order state (`polymarketOrders`/`polymarketOrderFillStatus`),
automations, Kalshi trading+portfolio, search, notifications, bookmarks/filters/comments/
news/tracked-traders, and admin.

---

## 3. What's left for Caesar to go live

"Go live" = a real user can log in, fund a wallet, and place/manage **real trades**
safely. Hard rule still in force: **no mainnet / real funds** until
`docs/MAINNET-GATES.md` 1–2 are confirmed on a funded mainnet dry-run.

### Critical path — minimum viable live (Polymarket-only trading)
1. **Resolve mainnet gates** (`docs/MAINNET-GATES.md`): confirm pUSD collateral
   decimals/approvals on the live contract; register + verify the `bytes32` builder code;
   exercise the whole path once on a funded mainnet account. *(Kalshi RSA-PSS, gate 3,
   only needed if Kalshi trading ships at launch — a Polymarket-only launch defers it.)*
2. **Execute wallet setup on mainnet** — the logic (Safe deploy, V1/V2 approvals, CLOB
   API-key derivation) is built & unit-tested but has **never run** (no Amoy CLOB). It's
   the on-ramp for any trade; must be exercised live behind the mainnet flag.
3. **Complete Phase 3 trading loop** (the product's reason to exist):
   - Real **sign + submit** path (currently gated/no-op) against the live CLOB, with
     L1-auth → L2-HMAC creds and order-status polling (DELAYED→MATCHED).
   - **Order-entry UI** on market detail (market/limit tabs, fee + builder-fee breakdown)
     — there is no trading UI yet.
   - **Portfolio**: open/closed positions, balances, PnL, `claimPosition` redeem — none
     built; a trader must see and manage positions.
   - Reliable submit/retry (the bible specs Temporal workflows; a simpler idempotent
     submitter is acceptable for MVP).
4. **Phase 6 launch-blockers for a real-money product:**
   - **Geoblock + compliance gating** (legal must-have for US real-money).
   - **Security review** of the signing path + Privy token verification.
   - **Rate limits**; secrets/error handling hardening.
5. **Productionize**: scheduled ingest worker (data is manually refreshed today); Privy
   `allowed_domains` (currently empty → add the prod domain); real hosting + TLS +
   managed Postgres/Redis (today's infra is loopback docker-compose); bundle code-split
   (one 3 MB Privy/walletconnect chunk).

### Deferred past launch (Parity-parity, not go-live blockers)
Phase 5 differentiators (multiview ladder, counterparty analysis, signals screener,
hubs/monitor/data/news, notifications center, tracked-trader feed) and the remaining
Phase 6 ops (admin console, builder-fee reconciliation, analytics).

### Honest one-line status
**Read-only terminal + identity are live-quality; real trading is not.** The trading
engine exists only as gated, offline-tested plumbing — closing items 1–3 above (mainnet
gates, live wallet setup, the sign/submit + portfolio + order UI loop) is what stands
between here and a usable live product.
