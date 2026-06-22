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

### `apps/web` — auth wiring + onboarding
- `components/PrivyAuthBridge`: caches Privy access + identity tokens and registers
  the synchronous getter `lib/apollo.ts` already exposed, so GraphQL **and** the WS
  `connectionParams` carry auth. Refetches `GetMe` on login/logout transitions.
- `components/AccountMenu` (nav footer): Privy login modal when logged out; wallet/
  email label + logout when in.
- `components/TosGate`: blocking ToS modal shown when `me && !tosAccepted`; "Accept"
  calls `syncTosFromPrivy`. Read-only browsing stays available behind it.
- `main.tsx`: login methods trimmed to **email + wallet** (Google/Twitter are
  disabled in the dashboard — re-add when enabled, else dead buttons); embedded
  wallet `createOnLogin: users-without-wallets`. Bridge + gate mounted.

## Verification
| Gate | Result |
|---|---|
| `pnpm -r typecheck` (all packages) | ✅ |
| web production build | ✅ |
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
- **Wallet-setup state machine** (server signer → Safe deploy → approvals → CLOB
  api key): the live CLOB-key step is impossible on testnet (no Amoy CLOB — see
  PHASE2-BLOCKERS §2) and gated behind the §15 mainnet items. Build offline +
  unit-test next.
- Invite-gate + WelcomeWizard mutations aren't in the SDL; flags are read, full
  flow deferred until those mutations are specced.
