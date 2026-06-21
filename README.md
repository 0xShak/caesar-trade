# Caesar Terminal

A from-scratch, feature-identical rebuild of **Parity** (predictparity.com): a multi-platform
prediction-markets trading terminal unifying **Polymarket** + **Kalshi** behind one GraphQL API,
with real on-chain trading, trader/counterparty analytics, multiview ladder trading, automations,
and live screeners.

- **Build bible:** `/root/Caesar-terminal.html` · **dossiers:** `/root/parity-study/`
- **Phase status:** Phase 0 ✅ (see `docs/PHASE0.md`). Next: Phase 1 (read-only terminal).

## Layout (pnpm + Turborepo monorepo)
```
apps/web                Vite + React 19 SPA (Apollo, TanStack, zustand, Privy, 5 themes)
apps/api                Fastify + GraphQL Yoga; spikes/ = Phase 0 de-risk scripts
packages/money          microdollar (bigint) math + decimal.js + fee math  (tested)
packages/chain          Polymarket address book + EIP-712 structs + Safe derivation (viem)
packages/chain/polymarket   ethers-v5-scoped CLOB client wrapper (quarantined)
packages/config         Zod boot-time env validation
packages/graphql-schema  the SDL contract (50q/29m/6s) + codegen
```

## Prerequisites
Node ≥20, pnpm 9.15, Docker. Copy env: `cp .env.example .env` and fill in secrets.

## Commands
```bash
pnpm install
pnpm infra:up                     # postgres+redis+temporal (loopback, ports 55432/56379/57233)
pnpm --filter @caesar/api dev     # GraphQL → http://localhost:4000/graphql  (GraphiQL)
pnpm --filter @caesar/web dev     # SPA     → http://localhost:3000
pnpm test                         # money property tests
pnpm typecheck                    # all packages + apps

# Phase 0 spikes
pnpm spike:polymarket             # EIP-712 sign + signature-verify (Amoy throwaway key)
pnpm spike:kalshi                 # RSA-PSS offline round-trip (+ live if demo creds set)
pnpm spike:privy -- <accessToken> # verify a Privy token (or use web /spike-privy)
```

## Money & safety discipline
All money is **microdollars** (integer ×1e6, `bigint`) end-to-end; `decimal.js` only for notional.
Real-money trading is gated behind the verify-before-mainnet items in `docs/PHASE0.md` — **do not
trade real funds until those are resolved.** Secrets live in `.env` (gitignored); never commit keys.
