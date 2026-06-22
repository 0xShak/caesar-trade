# Phase 2 (Identity & Wallet) — what's blocked & how to unblock

**TL;DR:** Phase 2's *core* (Privy login → embedded wallet → trading-wallet setup) cannot
be built/verified autonomously because it needs **your secrets** and an **unverified
external fact** (whether a Polymarket CLOB exists on Amoy). Everything that does NOT need
those is either already in place (Phase 0 wired the Privy code paths) or scaffoldable.
This doc is the exact checklist to unblock, written so a fresh session can resume fast.

---

## 1. Privy credentials  ← **you must provide**
Phase 2 login + server-side token verification + embedded-wallet extraction all run on
your Privy app.

**Provide:** in `/root/caesar/.env`
```
PRIVY_APP_ID=app_xxx
PRIVY_APP_SECRET=secret_xxx
VITE_PRIVY_APP_ID=app_xxx        # client-exposed app id (never the secret)
```
(`.env` is gitignored. The Zod env loader already declares these as optional —
`packages/config/src/index.ts`.)

**Then verify (Spike C round-trip — already coded):**
1. `pnpm --filter @caesar/api dev` and `pnpm --filter @caesar/web dev`
2. open `http://localhost:3000/spike-privy`, log in
3. the page POSTs the access + identity token to `POST /api/spike/privy-verify`
   (`apps/api/src/server.ts`) → expect `{ ok:true, userId }`.

**What I'll build once this is green:**
- Embedded-wallet extraction (`privy.getUser()` → EVM address) in the verify route.
- Real `me` resolver: read the Privy identity → user row (ToS, invite, wallet flags).
- FE auth wiring: `setAuthTokenGetter` in `apps/web/src/lib/apollo.ts` is already a hook
  point — connect it to Privy's cached tokens so GraphQL + the WS `connectionParams`
  carry auth. ToS dialog + invite gate + WelcomeWizard gated on `me` fields.

---

## 2. Amoy CLOB reality  ← **RESOLVED 2026-06-22 (Phase 0 open item #4)**
**Finding: there is NO Polymarket CLOB on Amoy testnet.** The CLOB is mainnet-only at
`https://clob.polymarket.com` (Polygon chain 137). The Amoy chain id (80002) exists in the
SDKs only to select testnet *contract addresses* (ctf_exchange, USDC) for EIP-712 domains —
not a testnet order-matching server. No sandbox/testnet trading env exists in Polymarket docs.

Phase 0's results explained: 401 on L1 auth = no API key on Amoy (and/or malformed L1 headers);
403 on `/order` = Cloudflare geoblock at the mainnet edge. (Sources: docs.polymarket.com,
github.com/Polymarket/py-clob-client constants.py.)

**Decision:** Phase 2 wallet-setup (Safe CREATE2 derivation — already in `@caesar/chain` —
EIP-712 order signing, L1/L2 header construction) is built + unit-tested **offline** with
known-good vectors. The live CLOB-API-key derivation step (`createOrDeriveApiKey()`) stays
**deferred behind the §15 mainnet gates**; it cannot be exercised on testnet.

---

## 3. (Optional) Funded Amoy EOA  ← only for a live on-chain test
For a real Safe-deploy / approval dry-run on Amoy, a throwaway **funded** Amoy key:
```
AMOY_PRIVATE_KEY=0x...    # throwaway only, NEVER a real-funds key
```
Not required to build Phase 2 logic; only to execute a live testnet deploy.

---

## Mainnet gates (block Phase 3 trading, NOT Phase 1/2/4) — see docs/MAINNET-GATES.md
1. Polymarket **collateral**: ✅ RESOLVED — `0xC011a7E1…2DFB` is real **pUSD** (CLOB V2
   collateral), not a placeholder; V1 used USDC.e. Code: `COLLATERAL_PUSD_V2`. Still verify
   decimals/approvals + the Amoy pUSD address.
2. Caesar **builderCode** (bytes32): ◑ Builder Program is live; register via the settings UI,
   carry it in the V2 order's `builder` field. Bundle's REST endpoints unverified — confirm
   with support.
3. **Kalshi RSA-PSS** scheme: ⛔ blocked (no demo creds — user has no phone). Deferred.
4. **Amoy CLOB reality**: ✅ RESOLVED — no testnet CLOB (see §2 above).

**Do not trade real funds until 1–2 are confirmed live on a funded mainnet dry-run.**

---

## What got built WITHOUT any of the above (so you can see progress now)
Phase 1 (read-only terminal) + Phase 4 (realtime) are **done and verified on public APIs**
— see `docs/PHASE1.md`, `docs/PHASE4.md`, and `docs/NIGHT-SESSION-LOG.md`.
