# Next-session prompt — Caesar Terminal (paste into a fresh Claude Code session)

---

You are continuing **Caesar Terminal**, a from-scratch rebuild of Parity (predictparity.com): a
GraphQL-first trading terminal unifying Polymarket + Kalshi. The monorepo lives at `/root/caesar`.

**Phase 0 is DONE.** Before doing anything, read these in order:
1. `/root/caesar/docs/PHASE0.md` — exactly what's built, what's verified, and the open items.
2. `/root/caesar/README.md` — layout + commands.
3. `/root/Caesar-terminal.html` §04 (GraphQL), §09 (Polymarket/Kalshi normalization), §13 Phase 1.
4. Dossiers as needed: `/root/parity-study/dossier-graphql-schema.md`,
   `dossier-platform-layer.md`, `dossier-trading-mechanics.md`.

**Conventions (already established — match them):** pnpm + Turborepo, Node 20, strict TS
(`verbatimModuleSyntax`, relative imports use `.js`), plain CSS + CSS vars (no Tailwind), viem v2
(ethers quarantined to `packages/chain/polymarket`), money = microdollar `bigint` via `@caesar/money`.
Self-hosted on biggie; infra is loopback-bound docker-compose on remapped ports (55432/56379/57233).

**Working style:** keep context rot low — delegate bulky/independent work to parallel subagents
(have them return short manifests, not file dumps), keep correctness-critical code (signing, money,
schema) in the lead. Write a short summary at the end of each meaningful milestone and, when this
session is getting long, hand off with an updated version of this prompt.

## Do first (finish the gated Phase 0 spikes — quick wins)
- **Spike C (Privy):** ask me for `PRIVY_APP_ID` + `PRIVY_APP_SECRET`, put them in `/root/caesar/.env`
  (+ `VITE_PRIVY_APP_ID`), run api + web, open `http://localhost:3000/spike-privy`, log in, confirm
  `/api/spike/privy-verify` returns `{ok:true,userId}`. Then wire embedded-wallet extraction (getUser).
- **Spike B (Kalshi):** ask me for a `demo-api.kalshi.co` API key id + RSA private key PEM; run
  `pnpm spike:kalshi` and confirm the live `/portfolio/balance` 200.
- **(Optional) Spike A live:** if I provide a funded Amoy key, investigate the L1 401 / whether
  Polymarket runs an Amoy CLOB at all (open item #4 in PHASE0.md).

## Then: Phase 1 — read-only terminal (bible §13)
Build inside-out, normalize at ingest (microdollars), resolvers read the normalized store:
1. **Ingesters** → normalized Postgres: Polymarket (gamma keyset `?condition_ids=` + CLOB) and Kalshi
   (series→event→market). Set up Drizzle schema + migrations first. Use Temporal or simple cron workers.
2. **Replace fixtures**: implement `GetMarkets`/`GetMarket`/`GetEvent`/`GetTags` resolvers + the
   `MarketFiltersInput` filtering against Postgres. Keep the SDL contract unchanged.
3. **Markets browser** (grid + filters + tags + search + URL sync) and **market detail** (orderbook
   analysis, visx price chart, trades tape, market strength) on the existing web shell.
4. **Traders**: `GetTraders`/`GetTrader` + profile (traits, badges, positions).

Propose a Phase 1 plan (plan mode) and get my approval before building, same as Phase 0.

**Do NOT touch mainnet / real funds.** The verify-before-mainnet gates in PHASE0.md
(real collateral address, builderCode, Kalshi scheme, Amoy CLOB reality) must be resolved first.
