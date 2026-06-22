# Next-session prompt — Caesar Terminal (paste into a fresh Claude Code session)

> Handoff written 2026-06-22 after: Phase 2 login verified LIVE, parallel Phase-3
> branch merged, live CLOB orderbook depth shipped. Repo pushed:
> **https://github.com/0xShak/caesar-trade** (`main`, at `4369096`).

---

You are continuing **Caesar Terminal** — a GraphQL-first trading terminal unifying
Polymarket + Kalshi, a from-scratch rebuild of Parity (predictparity.com). Monorepo at
`/root/caesar`, pushed to `github.com/0xShak/caesar-trade` (`main`).

## Read first (in order)
1. Your **memory** (`MEMORY.md` + entries) — loads automatically; has the current stage +
   key external facts (Privy verified & login working, Kalshi skipped/no-phone, collateral =
   real pUSD, no Amoy CLOB). Trust it but re-verify any file/flag it names before acting.
2. `docs/PHASE2-SUMMARY.md` — **start here**: what's done, where we stand vs the bible's
   7 phases, and the go-live gap analysis.
3. `docs/MAINNET-GATES.md` — **safety-critical**: the verify-before-mainnet gates.
4. `docs/PHASE2.md` (identity/wallet) · `docs/PHASE1.md` · `docs/PHASE4.md` ·
   `docs/PARALLEL-TRACKS.md`. As needed: the bible `/root/Caesar-terminal.html` (§ refs) and
   `/root/parity-study/dossier-{trading-mechanics,onchain-signing,graphql-schema}.md`.

## Goal this session
**Ship portfolio read views, then move the terminal toward live trading — running ASAP.**
Hard rule unchanged: **NO mainnet / real funds** until `docs/MAINNET-GATES.md` 1–2 are
confirmed on a funded mainnet dry-run. Match repo conventions (pnpm/Turbo, strict TS, viem
v2, plain CSS, microdollar `bigint` money). Verify (typecheck + tests + a live query) before
claiming anything done. Commit per logical chunk; push only when asked.

## Do FIRST (bring it up)
```bash
pnpm infra:up
pnpm --filter @caesar/db db:migrate
pnpm --filter @caesar/ingest ingest:once          # if markets table is empty (~3 min)
pnpm --filter @caesar/api dev                      # GraphQL + WS on :4000
# web: run on a CLEAN port — :3000 is taken by an unrelated server on this host:
apps/web/node_modules/.bin/vite apps/web --port 3010 --strictPort --host 127.0.0.1
pnpm -r typecheck && pnpm --filter @caesar/chain test && pnpm --filter @caesar/money test
```
Sanity: `me` is null unauth, `markets` returns ~4734, `marketOrderbook(marketId)` returns a
live book on an active Polymarket market.

## The plan (my call — sequence these)

### Track 1 — Portfolio read views  ✅ no mainnet gate, highest user value, do FIRST
Everything needed already exists; this is mostly wiring:
- The Polymarket **`/positions` data-API client already exists** in
  `apps/api/src/resolvers/traders.ts` (`POLY_DATA_API = https://data-api.polymarket.com`,
  `/positions?user=<addr>`). Portfolio = the **authed user's** positions, keyed by their
  `polymarketTradingAddress` (already derived + persisted on the `users` row).
- SDL already has the types/fields: `PortfolioStats`, `Position`, `PositionConnection`,
  `WalletBalance(s)`, and `Query.portfolioStats / openPositions / closedPositions /
  userTrades / walletBalance`. **No SDL change needed** — just resolve them.
- Build a new `apps/api/src/resolvers/portfolio.ts`: resolve the user's trading address from
  ctx (`me`), call `/positions` (open + value), compute `portfolioStats` (PnL ranges), map to
  the SDL shapes (microdollar `bigint` discipline — see `traders.ts` for the money wire-contract).
  `walletBalance` = read-only ERC20 `balanceOf` of the Safe via `publicClientFor(137, POLYGON_RPC_HTTP)`
  for **pUSD** (`COLLATERAL_PUSD_V2`) + **USDC.e** (`CANONICAL_USDC_E_POLYGON`) — a chain READ,
  not a write; safe, no gate. Wire into `resolvers/index.ts` Query (these are Track-B's lane).
- **Web**: extend `apps/web/src/app/PortfolioPage.tsx` (today it only shows wallet-setup status)
  with positions table (open/closed, PnL coloring), portfolio stats header, and balances.
  Reuse existing `mono-table` / `num` / money formatters.
- **Note**: our test account (`thanhquangnguyen343@gmail.com`) has **no positions/balance yet**
  (never traded) → it renders empty for us. Verify correctness against a known active trader
  address (the `traders` page already does this) before claiming done.
- **Gated subset — defer**: `userOrders` / `polymarketOrders` (live OPEN orders) need CLOB
  **API creds** (mainnet wallet setup), so leave those behind the mainnet flag. Positions /
  PnL / balances / trade history are all public-data/RPC and ship now.

### Track 2 — Order-entry UI shell  (build now, execution stays gated)
- Add an order-ticket panel (market/limit tabs, size, fee + builder-fee preview) on the
  market-detail page, wired to the **existing gated** `placeOrder` mutation
  (`resolvers/orders.ts` + `@caesar/chain` `orders.ts`, already merged). It should
  **preview/validate only** — submission stays behind `CAESAR_ENABLE_MAINNET_TRADING`
  (default off). Goal: the trading UI is ready the instant the gates open. Never sign a real order.

### Track 3 — Live-trading unlock  ⛔ BLOCKED ON THE USER (see below)
The mainnet dry-run that flips real trading on. Don't attempt until the user provides the
items in "Need from you".

## Need from you (blocking live trading — nothing blocks Track 1/2)
1. **Funded mainnet dry-run** for `MAINNET-GATES.md` gates 1–2:
   - Register a builder profile at `polymarket.com/settings?tab=builder` and paste me the
     **`bytes32` builder code**.
   - A **funded Polygon mainnet wallet** (a little pUSD/USDC.e + MATIC for gas) so we can
     exercise — behind the mainnet flag — wallet setup (Safe deploy → V1/V2 approvals → CLOB
     API-key derivation) and **one tiny real order**. I'll do the code; you fund + approve.
   - This is the only thing standing between "terminal that shows everything" and "terminal
     that trades real money." I cannot do it without a funded account.
2. **(For reliability/prod, optional now)** a keyed **Polygon RPC** (Alchemy/Infura URL) for
   `POLYGON_RPC_HTTP` — the public `polygon-rpc.com` default works for dev reads but rate-limits.
3. **(Deploy-time)** add the prod domain to Privy `allowed_domains` (currently empty); optionally
   enable Privy **identity tokens** (drops one API call in wallet decode — minor).
4. Kalshi trading stays deferred (no phone to register) — launch **Polymarket-only**.

## Conventions / state
pnpm + Turborepo, Node 20, strict TS (`verbatimModuleSyntax`, relative imports end `.js`),
plain CSS + vars (no Tailwind), viem v2 (ethers quarantined to `packages/chain/src/polymarket/`),
money = microdollar `bigint` via `@caesar/money`. Infra = loopback docker-compose (postgres
55432 / redis 56379). The Privy app id only loads if `VITE_PRIVY_APP_ID` is read from the
**repo-root `.env`** (Vite `envDir` is set to the root — don't move it). Tests: chain 30/30,
money 11/11; keep them green.

**Hard rule:** no mainnet, no real funds, until `docs/MAINNET-GATES.md` 1–2 are confirmed live.
