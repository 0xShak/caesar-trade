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

## 2. Amoy CLOB reality  ← **external fact to confirm** (Phase 0 open item #4)
Trading-wallet setup step 5 derives a CLOB API key via `ClobClient.createOrDeriveApiKey()`.
In Phase 0, live CLOB L1 auth on Amoy returned **401**, and `/order` returned **403
geoblock** — suggesting `clob.polymarket.com` is **mainnet-only** and Amoy may have no CLOB
(or needs a different host / a deployed+approved Safe first).

**Needs deciding (you / docs):** does a testnet CLOB exist? If not, Phase 2 wallet-setup
can only be exercised against **mainnet**, which is gated by §15 (do NOT trade real funds
until the collateral address + builderCode + Kalshi scheme gates are resolved).

**Options when you're back:**
- Confirm via Polymarket docs/support whether an Amoy CLOB host exists.
- If mainnet-only: we build + unit-test the setup *state machine* offline (Safe CREATE2
  derivation is already in `@caesar/chain`), but defer the live CLOB-key step behind the
  mainnet gates.

---

## 3. (Optional) Funded Amoy EOA  ← only for a live on-chain test
For a real Safe-deploy / approval dry-run on Amoy, a throwaway **funded** Amoy key:
```
AMOY_PRIVATE_KEY=0x...    # throwaway only, NEVER a real-funds key
```
Not required to build Phase 2 logic; only to execute a live testnet deploy.

---

## Mainnet gates (still open from Phase 0 — block Phase 3 trading, NOT Phase 1/4)
1. Real Polymarket **collateral address** (bundle's `0xC011a7E1…2DFB` is a placeholder).
2. Caesar **builderCode** (bytes32) registration + `/fees/builder-fees/<code>` check.
3. Confirm **Kalshi RSA-PSS** scheme against the official example (needs demo creds — see
   `docs/NEXT-SESSION-PROMPT.md`).
4. **Amoy CLOB reality** (see §2 above).

**Do not trade real funds until 1–3 are resolved.**

---

## What got built WITHOUT any of the above (so you can see progress now)
Phase 1 (read-only terminal) + Phase 4 (realtime) are **done and verified on public APIs**
— see `docs/PHASE1.md`, `docs/PHASE4.md`, and `docs/NIGHT-SESSION-LOG.md`.
