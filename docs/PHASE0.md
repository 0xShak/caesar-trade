# Caesar Terminal — Phase 0 summary (foundations + de-risking spikes)

**Status: ✅ COMPLETE** · date 2026-06-22 · monorepo at `/root/caesar`

Phase 0 goal (bible §12/§13): lay a convention-matching scaffold and prove the three
hardest external integrations on testnet **before any product UI or mainnet**. Done.

## What was built
- **pnpm + Turborepo monorepo**, Node 20, strict TS (ES2022, bundler res, `verbatimModuleSyntax`).
  Matches the user's kylx/watchzer0 conventions; plain CSS + CSS-vars (no Tailwind); viem v2.
- **`packages/money`** — microdollar (`bigint`) integer math + `decimal.js` notional + Polymarket
  fee math (bible §7). **11/11 property tests pass**, incl. the 1M×$0.07 no-float-drift check.
- **`packages/chain`** — verbatim Polymarket address book + EIP-712 V1/V2 order structs + ClobAuth
  + CREATE2 `deriveSafe`/`deriveProxyWallet` (from `dossier-onchain-signing.md`). The placeholder
  collateral hazard is flagged in-code. `chain/polymarket/` quarantines ethers v5 + clob-client.
- **`packages/config`** — Zod boot-time env validation (`loadEnv()`).
- **`packages/graphql-schema`** — the full Parity **SDL contract** (`schema.graphql`): core entities,
  all enums/inputs, and all ~50 queries / ~29 mutations / 6 subscriptions as field signatures
  (root fields nullable so unimplemented ones resolve null). Codegen config present.
- **`apps/api`** — Fastify v5 + GraphQL Yoga at `/graphql` (GraphiQL on), driven via `yoga.fetch()`
  to avoid the Fastify/Yoga raw-stream hang. Stub resolvers serve fixtures (health/markets/market/
  tags/me). `POST /api/spike/privy-verify` verifies Privy tokens server-side.
- **`apps/web`** — Vite + React 19 SPA: 5-theme system (pre-paint, no flash), Apollo + TanStack +
  zustand + Privy providers, NavSidebar shell, MarketsPage (live `GetMarkets`), SpikePrivyPage.
- **`docker-compose.yml`** — Postgres 16 + Redis 7 + Temporal dev server + UI, loopback-bound on
  **remapped host ports** (55432/56379/57233/58233) to coexist with biggie's existing stacks.

## Verification (all green)
| Gate | Result |
|---|---|
| `pnpm install` | ✅ (peer warnings only — visx/lucide/privy lag React 19; privy-server prefers ethers 6, clob-client pins ethers 5) |
| `@caesar/money` tests | ✅ 11/11 |
| typecheck money/chain/config/graphql-schema/api/web | ✅ all clean |
| api boots + GraphQL `markets`/`market`/`tags`/`me` return fixtures | ✅ |
| web production build | ✅ (one 3MB chunk = Privy/walletconnect; split later) |
| docker infra up + healthy | ✅ postgres+redis healthy, temporal+ui up |
| **Spike A — Polymarket signing** | ✅ **PASS**: V2 order EIP-712 signature **recovers to signer** (the hard gate). Live CLOB L1 returned 401 + `/order` 403 geoblock — expected, see open items. |
| **Spike B — Kalshi RSA-PSS** | ✅ PASS offline (RSA-PSS SHA-256 round-trip); live call DEFERRED (no demo creds) |
| **Spike C — Privy** | ⏸ DEFERRED — code wired; needs `PRIVY_APP_ID/SECRET` in `.env` + interactive login |

## Open items carried forward
**Needs your input/creds (next session):**
- Paste `PRIVY_APP_ID` + `PRIVY_APP_SECRET` into `.env` → run Spike C round-trip (web `/spike-privy`).
- Provision `demo-api.kalshi.co` API key + RSA private key PEM → run Spike B live.
- (Optional) fund the generated Amoy throwaway EOA for a live CLOB attempt.

**Verify-before-mainnet gates (do NOT trade real funds until resolved — bible §15):**
1. Real Polymarket collateral address (bundle's `0xC011a7E1…2DFB` is a placeholder).
2. Caesar's `builderCode` (bytes32) registration via `/auth/builder-api-key` + `/fees/builder-fees/<code>`.
3. Confirm Kalshi RSA-PSS scheme against the official example (the spike cites docs.kalshi.com).
4. **Amoy CLOB reality**: the L1 401 suggests `clob.polymarket.com` is mainnet-only / Amoy needs a
   different host (or a deployed+approved Safe). Confirm whether a testnet CLOB exists before Phase 3.

**Tech debt / notes:**
- `@privy-io/server-auth` wants ethers 6 but clob-client pins ethers 5 (peer warning only). Watch at runtime.
- Embedded-wallet extraction in `/api/spike/privy-verify` (getUser) is stubbed — wire next session.
- Subscriptions (graphql-ws) are declared in SDL but not implemented (Phase 4).

## Next phase
**Phase 1 — read-only terminal**: real ingesters (Polymarket gamma keyset + CLOB, Kalshi) →
normalized Postgres (microdollars) → resolvers replace fixtures → markets browser + filters +
market detail. See `docs/NEXT-SESSION-PROMPT.md`.
