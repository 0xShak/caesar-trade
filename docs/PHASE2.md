# Caesar Terminal — Phase 2 summary (identity & auth)

**Status: ✅ CORE DONE & verified (unauthenticated paths)** · date 2026-06-22

Phase 2 goal (bible §13): Privy login → server-verified identity → embedded
wallet → onboarding gates. Unblocked once the Privy creds were verified valid
(app `cmqp5sqdc…`, name "Caesar"). The live logged-in round-trip needs **your**
interactive login (+ the dashboard embedded-wallet toggle) — see "Needs you".

## What was built

### `packages/db` — `users` table
- New `users` table (PK = Privy DID). Onboarding flags (`tosAccepted`/`tosVersion`,
  `inviteClaimed`, `parityAdmin`, `welcomeWizardCompleted`), `embeddedWalletAddress`
  + `email` backfilled from Privy, and trading-wallet flags (`hasServerSigner`,
  `isSafeDeployed`, `hasV1/V2Approvals`, `hasApiCredentials`) defaulting false.
  No money columns. Migration `0001_*` generated + applied.

### `apps/api` — Privy auth + `me`
- `src/auth.ts`: lazy `PrivyClient` singleton; `buildContext(headers)` (HTTP) and
  `buildWsContext(connectionParams)` (subscriptions) verify the access token via
  `verifyAuthToken` → `{ auth: { userId, idToken } | null }`. Invalid/absent tokens
  resolve `auth: null` (never throws → public reads unaffected). `getEmbeddedWallet`
  decodes the identity token **locally** via `getUser({ idToken })` (no rate-limited
  API call) and extracts the `walletClientType === "privy"` ethereum address.
- Yoga `context` + graphql-ws `context` wired to those builders (`server.ts`).
- `resolvers/me.ts`: `me` loads-or-creates the user row, backfills wallet/email,
  derives `isWalletSetupComplete`. `syncTosFromPrivy(acceptTos)` stamps ToS v1.0.
  Both require auth (null when logged out). Resolver map updated; stub removed.
- Spike C route (`/api/spike/privy-verify`) now also returns `embeddedWalletAddress`.

### `packages/chain` — wallet-setup state machine (offline, unit-tested)
- `src/wallet-setup.ts` (pure, viem-only — ethers stays quarantined in `./polymarket`):
  - **Step machine:** `nextSetupStep(flags)` / `walletSetupProgress(flags)` over the 5
    ordered steps (connect → deploy Safe → V1 approvals → V2 approvals → derive CLOB key).
  - **Funder derivation:** `deriveTradingWallet(owner, "safe"|"proxy")` → deterministic
    CREATE2 address + `SignatureType` (wraps the existing `deriveSafe`/`deriveProxyWallet`).
  - **Approval calldata:** `requiredApprovals(chainId, "v1"|"v2")` lists the USDC (ERC20
    approve) + CTF (ERC1155 setApprovalForAll) txs per exchange spender; `encodeErc20Approve`
    / `encodeErc1155SetApprovalForAll`.
  - **L1 login:** `buildClobAuthTypedData(addr, chainId, ts, nonce)` → the EIP-712 ClobAuth
    payload to sign.
- `src/wallet-setup.test.ts`: **11/11 vitest** — state-machine transitions, regression-locked
  derived addresses (Safe `0xfDABD659…`, proxy `0x60a66958…` for a fixed owner), approval
  selectors/counts, ClobAuth payload shape. `vitest` added to the package.
- **Wired into `me`:** `polymarketTradingAddress` + `polymarketWalletKind` ("safe") are
  derived from the embedded signer and persisted (a *predicted* address — not deployed;
  verify-before-mainnet). EXECUTING any step (deploy/approvals/CLOB key) stays gated behind
  the §15 mainnet items — there is no Amoy CLOB to exercise against.

### `apps/web` — auth wiring + onboarding
- `components/PrivyAuthBridge`: caches Privy access + identity tokens and registers
  the synchronous getter `lib/apollo.ts` already exposed, so GraphQL **and** the WS
  `connectionParams` carry auth. Refetches `GetMe` on login/logout transitions.
- `components/AccountMenu` (nav footer): Privy login modal when logged out; wallet/
  email label + logout when in.
- `components/TosGate`: blocking ToS modal shown when `me && !tosAccepted`; "Accept"
  calls `syncTosFromPrivy`. Read-only browsing stays available behind it.
- `app/PortfolioPage`: read-only **wallet-setup status** — shows the derived trading-wallet
  (Safe) address + a 5-step checklist driven by the `me` flags. No action buttons (the steps
  are mainnet-gated). Replaces the `/portfolio` placeholder.
- `main.tsx`: login methods trimmed to **email + wallet** (Google/Twitter are
  disabled in the dashboard — re-add when enabled, else dead buttons); embedded
  wallet `createOnLogin: users-without-wallets`. Bridge + gate mounted.

## Verification
| Gate | Result |
|---|---|
| `pnpm -r typecheck` (all packages) | ✅ |
| `@caesar/chain` wallet-setup tests | ✅ 11/11 |
| `@caesar/money` tests (regression) | ✅ 11/11 |
| web production build | ✅ |
| api boots with `@caesar/chain` import (ethers not pulled) | ✅ |
| Drizzle migration apply | ✅ users table |
| Privy creds valid (live API) | ✅ HTTP 200, app "Caesar" |
| `me` unauthenticated | ✅ null |
| `me` with bogus token | ✅ null (graceful, no error) |
| `syncTosFromPrivy` unauthenticated | ✅ null (no crash) |
| public `markets`/`tags` still work alongside `me` | ✅ |

## Needs you (live round-trip)
1. **Flip the Privy dashboard "create embedded wallet on login" toggle** (currently
   off → `mode: user-controlled-server-wallets-only`). Until then login works but no
   embedded wallet is provisioned, so `embeddedWalletAddress` stays null.
2. **Interactive login** at `http://localhost:3000` (or `/spike-privy`) with api+web
   running → confirm `me` returns a real row, the wallet address populates, and the
   ToS modal → Accept persists. (Optional: re-enable Google/Twitter OAuth in the
   dashboard if you want those login methods.)

## Deferred (correctly)
- **Executing** wallet-setup steps (deploy Safe, send approvals, derive live CLOB
  key): impossible on testnet (no Amoy CLOB — PHASE2-BLOCKERS §2) and gated behind
  the §15 mainnet items. The pure logic + calldata + derivation are built & tested
  (see `packages/chain`); only the on-chain execution waits.
- Invite-gate + WelcomeWizard mutations aren't in the SDL; flags are read, full
  flow deferred until those mutations are specced.
