# Next-session prompt — Caesar Terminal (paste into a fresh Claude Code session)

> Handoff written 2026-06-22 after Phases 0/1/2/4. Repo is live and pushed:
> **https://github.com/0xShak/caesar-trade** (branch `main`).

---

You are continuing **Caesar Terminal**, a from-scratch rebuild of Parity (predictparity.com):
a GraphQL-first trading terminal unifying Polymarket + Kalshi. Monorepo at `/root/caesar`,
pushed to `github.com/0xShak/caesar-trade` (`main`).

## Read first (in order)
1. Your **memory** (`MEMORY.md` + entries) loads automatically — it has the current stage and
   the key external facts (Privy creds verified, Kalshi skipped/no-phone, no Amoy CLOB, collateral
   = real pUSD). Trust it but verify any file/flag it names still exists before acting on it.
2. `docs/PHASE2.md` — identity/auth + wallet-setup (most recent work).
3. `docs/MAINNET-GATES.md` — **safety-critical**: the verify-before-mainnet constraints + the
   resolved collateral (pUSD) / builder-code findings.
4. `docs/PHASE1.md` (read-only terminal) + `docs/PHASE4.md` (realtime) + `docs/PHASE0.md`
   (foundations). `README.md` for layout/commands.
5. As needed: the bible `/root/Caesar-terminal.html` (§ refs) and dossiers in
   `/root/parity-study/` (esp. `dossier-trading-mechanics.md`, `dossier-onchain-signing.md`).

## Current state (all verified, all pushed)
- **Phase 0** foundations ✅ · **Phase 1** read-only terminal ✅ (+ visx price chart) ·
  **Phase 2** identity/auth ✅ core + wallet-setup logic (11/11 tests) · **Phase 4** realtime ✅.
- **4043 Polymarket + 691 Kalshi** markets ingest into Postgres; GraphQL serves the unchanged
  Parity SDL (+ a `marketPriceHistory` extension); microdollar `bigint` money discipline throughout.
- **Phase 3 (real-fund trading): NOT started — hard-gated.** Do NOT trade real funds / touch
  mainnet until the `docs/MAINNET-GATES.md` items are confirmed on a funded mainnet dry-run.

## Conventions (match them)
pnpm + Turborepo, Node 20, strict TS (`verbatimModuleSyntax`, relative imports end `.js`), plain
CSS + CSS vars (no Tailwind), viem v2 (ethers quarantined to `packages/chain/src/polymarket/`),
money = microdollar `bigint` via `@caesar/money`. Infra is loopback docker-compose on remapped
ports (postgres 55432 / redis 56379). Commit per logical chunk with the established message style;
push to `origin main` only when asked. Keep signing/money/schema correctness-critical code in the
lead; delegate bulky/independent search+build to parallel subagents (have them return short
manifests, not file dumps). Verify (typecheck + tests + a live query) before claiming done.

## Do FIRST (quick, user-gated)
**Confirm the Phase 2 live login round-trip** — embedded-wallet creation is now ENABLED in the
Privy dashboard. With `pnpm --filter @caesar/api dev` + `pnpm --filter @caesar/web dev` running,
ask the user to log in at `http://localhost:3000` (or `/spike-privy`). Confirm: `me` returns a
real row, `polymarketTradingAddress` (derived Safe) populates, and the ToS modal → Accept
persists. If the embedded wallet address is still null, check the dashboard toggle + that the FE
`loginMethods`/`createOnLogin` in `apps/web/src/main.tsx` match.

## Then — pick with the user (two parallel tracks)
**Track A — Phase 3 trading, built OFFLINE + unit-tested (live execution stays mainnet-gated).**
Mirror how wallet-setup was done. `@caesar/chain` already has V1/V2 order structs, domains,
`recoverV2OrderSigner`, `buildL2HmacSignature`, `createClobClient`/`deriveApiCreds`. Build:
order construction (amounts↔micro, tick rounding, salt/timestamp), the `placeOrder`/`cancelOrder`
mutation plumbing to the CLOB client, and the L1-auth→L2-HMAC request flow — all unit-tested with
vectors. Use collateral = **pUSD** (`COLLATERAL_PUSD_V2`) for V2 and the `builder` bytes32 field.
Gate every live/network call behind an explicit mainnet flag; never sign a real order.

**Track B — read-only depth & infra (no gates, fully shippable).**
- CLOB **orderbook depth** on the detail page (public `/book` endpoint + the
  `wss://ws-subscriptions-clob.polymarket.com` firehose) — replaces the 3s poll.
- **Cross-venue Event unification** (events are per-platform today).
- **Scheduled ingest worker** (Temporal/cron) so data stays fresh without a manual run.
- Web bundle **code-split** (one 3MB Privy/walletconnect chunk).

## Run it
```bash
pnpm infra:up
pnpm --filter @caesar/db db:migrate
pnpm --filter @caesar/ingest ingest:once     # populate (~3 min); or `ingest` to poll
pnpm --filter @caesar/api dev                # GraphQL + WS on :4000
pnpm --filter @caesar/web dev                # SPA on :3000  → /markets, /traders, /portfolio
pnpm -r typecheck && pnpm --filter @caesar/chain test && pnpm --filter @caesar/money test
```

**Hard rule:** no mainnet, no real funds, until `docs/MAINNET-GATES.md` 1–2 are confirmed live.
