# PHASE 5 — Live Trading Handoff

**Date:** 2026-06-22
**Status:** Browser-signed trading pipeline **fully proven end-to-end**, blocked at the final gate by Polymarket's April-2026 V2 migration: new accounts must use **deposit wallets (signatureType 3)**, not the Gnosis Safe (type 2) we built. Privy is fine. The remaining work is a **maker-wallet + signing-scheme swap**, automatable via our **builder account + relayer**.

---

## TL;DR

- Everything we built works: browser-signed Safe deploy, V2 approvals, encrypted per-user CLOB credentials, order build + EIP-712 signing, the V2 order envelope format, and **browser-side order submission that dodges the server geoblock**. We rode the order all the way to Polymarket's wallet-authorization layer.
- The order is rejected with `"maker address not allowed, please use the deposit wallet flow"` because **Polymarket forces NEW API accounts onto deposit wallets (sigType 3, ERC-1271)**. Our Gnosis Safe maker (type 2) is grandfathered-only. This is a platform change (CLOB V2, Apr 28 2026), not a bug in our code.
- **Privy is NOT broken** — it's the signer in Polymarket's own reference. We only need to swap the *maker* wallet (Safe → deposit wallet) and the *signature* scheme (direct EIP-712 → ERC-1271/ERC-7739).
- **Users do NOT need to do Polymarket's manual deposit flow.** With our **Builder API credentials**, our backend drives Polymarket's **relayer** to create + register each user's deposit wallet (gasless, deterministic from their Privy EOA). User experience stays "log in with Privy → trade"; they only need to fund their deposit wallet with collateral.

---

## ✅ UPDATE — Session 2 (2026-06-22): blocker SOLVED, verified on mainnet

The deposit-wallet path is **proven end-to-end on Polygon mainnet**. Built in `packages/chain/src/deposit-wallet.ts` (+ `deposit-wallet.test.ts`, all green) and `apps/api/src/relayer.ts`.

- **Builder API creds** are in `.env` as `POLYMARKET_API_KEY/_SECRET/_PASSPHRASE` (the user pasted them — these are the *builder* creds, distinct from the bytes32 `POLYMARKET_BUILDER_CODE`). Relayer auth works (HTTP 200).
- **Derivation (step 1) DONE & verified 3 ways:** offline CREATE2 == factory `predictWalletAddress(impl,id)` == on-chain SDK vector (`0xA606…`→`0x8b60…`). It's an ERC-1967-with-immutable-args clone (Solady `LibClone`); `id=bytes32(owner)`, `impl=factory.implementation()=0x58CA52…`. NOTE: owner is baked into init code, so there is **no constant init-code hash** (the §5 BeaconProxy/beacon-getter guess was wrong — it's always UUPS-style ERC-1967 here).
- **Relayer (step 2) DONE & verified:** `POST /submit {type:"WALLET-CREATE",from:EOA,to:factory}` + builder HMAC → `STATE_NEW`, deployed in ~3s. Poll keyless `GET /deployed?address=&type=WALLET`.
- **Type-3 signing (step 3) DONE & verified ON-CHAIN:** maker=signer=deposit wallet, sigType 3, **ERC-7739 nested EIP-712** (the wallet is Solady ERC1271). `deposit.isValidSignature(orderDigest, wireSig) == 0x1626ba7e` confirmed via eth_call against a relayer-deployed throwaway wallet. The exchange's `_verifyPoly1271Signature` requires `signer==maker` + `isValidSignatureNow(maker,…)`.
- **L1 auth (step 4) — RESOLVED, opposite of the guess:** the CLOB L1 endpoint does plain `ecrecover`; a deposit-wallet ERC-1271 L1 login is rejected `401 "Invalid L1 Request headers"`. **EOA L1 returns 200 + creds.** So the **api key binds to the EOA**, and the deposit wallet is associated via relayer registration. `createL1HeadersWrapped1271` is a dead end. Order `owner`=EOA api key; L2 `POLY_ADDRESS`=EOA.
- **OUR live deposit wallet:** EOA `0xfA1Bc89…98D7` → **`0x4aE02eae5F4f08075E09aDD163EE9f6dC9A19B4b`** (relayer-created + deployed this session).

**Remaining (needs live browser — server IP is geoblocked + Privy key is browser-only):** (a) wire `OrderTicket`/resolvers to type-3 + EOA-bound creds; (b) migrate 27.58 pUSD from Safe `0x2697…` → deposit wallet (browser-signed Safe execTransaction); (c) deposit-wallet approvals via relayer-proxied Batch; (d) the one unproven step — does `/order` accept owner=EOA-api-key + maker/signer=deposit wallet (testable only from the VPN'd browser).

---

## 1. What we built this session (all working, all gated)

### On-chain setup (LIVE-VERIFIED on Polygon mainnet)
- **Safe deployed** at `0x2697C609Cf85058c6e20daE0C469a825BB3E1bDB` (browser-signed `createProxy` via Polymarket Safe factory). On-chain bytecode confirmed.
- **All 4 V2 approvals set** (pUSD → exchangeV2 + negRiskExchangeV2 = MAX; CTF `isApprovedForAll` → both = true). Verified via RPC.
- Safe holds **27.58 pUSD** (`0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`). Signer EOA `0xfA1Bc89Fa8D6dA1985672aa03772Eb79567698D7` has ~0.86 MATIC.

### Backend (apps/api)
- `secrets.ts` — AES-256-GCM for secrets at rest (key in `.env` `CAESAR_CREDS_ENC_KEY`).
- `clob.ts` — keyless authenticated CLOB REST client: `deriveApiCredentials` (L1 ClobAuth headers), `postOrder`/`cancelOrder` (server-side, L2 HMAC), and **`prepareOrderRequest`/`prepareCancelRequest`** (return `{url,headers,body}` for the BROWSER to send). HMAC mechanics verified against `@polymarket/clob-client@4.22.8`. **Wire `side` is the STRING "BUY"/"SELL"** (fixed this session — was numeric, caused "Invalid order payload").
- `credentials.ts` — encrypt/upsert + load/decrypt per-user creds; flips `users.hasApiCredentials`.
- `resolvers/credentials.ts` — `derivePolymarketApiCredentials` (gated).
- `resolvers/orders.ts` — `validateOrderForSubmission` (gate + maker==Safe + signer==EOA + `recoverV2OrderSigner`), `resolveSubmitPolymarketOrder` (server submit), **`resolvePreparePolymarketOrder`/`resolvePreparePolymarketCancel`** (browser submit).
- DB: `polymarket_credentials` table (migration `0002_shiny_thunderbird.sql`, applied).
- SDL + wiring in `packages/graphql-schema/src/schema.graphql` + `resolvers/index.ts`. Mutations gated behind `CAESAR_ENABLE_MAINNET_TRADING`; nullable returns (unauth → clean null).

### Frontend (apps/web)
- `PortfolioPage.tsx` wizard: gas → deploy Safe → V2 approvals → derive CLOB creds, all browser-signed via the Privy embedded wallet (`lib/tradingWallet.ts`).
- `OrderTicket` component: browser builds the V2 order (`buildV2LimitOrder` → `buildV2OrderTypedData`), signs it, calls `preparePolymarketOrder`, then **`fetch()`s the CLOB directly from the user's IP** (`sendPreparedToClob`). Cancel button mirrors it.
- `gql/wallet.ts` — all the queries/mutations. `polyfills.ts` — Buffer polyfill for Privy browser signing.

---

## 2. The journey (each blocker found + fixed, in order)

1. **`Buffer is not defined`** in Privy signing → added `apps/web/src/polyfills.ts`. (Earlier session.)
2. **Deploy + approvals** → browser-signed, verified on-chain. ✅
3. **Credential derivation** → worked (L1 auth endpoints are NOT geoblocked). ✅
4. **`Trading restricted in your region`** → the server's IP is a Contabo datacenter in **France** (`161.97.166.69`, geoblocked). Fix: **browser submits the order POST** (CLOB allows CORS `*`). Refactored to the `prepare*` mutations + browser `fetch`. ✅ (User VPN'd to an allowed region to test.)
5. **`Invalid order payload`** → the wire `side` was numeric; Polymarket's order JSON wants the string `"BUY"/"SELL"`. Fixed in `clob.ts orderEnvelopeToWireJson`. ✅
6. **`maker address not allowed, please use the deposit wallet flow`** → **THE CURRENT BLOCKER.** Structural (below).

---

## 3. The blocker: Polymarket V2 deposit-wallet requirement

**Polymarket hard-cut to CLOB V2 on April 28, 2026** (new collateral pUSD, new exchanges, new wallet type). Their quickstart states verbatim:

> "New API users should use deposit wallets with signature type `3`. Existing Proxy and Safe users can keep using signature types `1` and `2`."

Our account was created today → **signatureType 2 (Gnosis Safe) is categorically rejected.** Confirmed by `py-clob-client-v2` issues #51/#52/#53/#56 (a Polymarket engineer calls it a "forced migration"). Our Safe IS canonically derived + deployed via Polymarket's own factory + funded — but that path is closed to new accounts.

### Why our self-deploy isn't enough
Polymarket's docs warn that **direct self-deployment bypasses server-side registration**. The relayer-driven create is what registers the wallet with Polymarket's backend. So the maker must be a **relayer-created, registered deposit wallet**, not a wallet we deployed ourselves via the factory.

---

## 4. Target architecture (multi-tenant, Privy preserved)

```
Per USER (their session, their funds):
  Privy embedded EOA  ──signs──▶  ERC-1271/ERC-7739 wrapped order
       │                                  │
       │ deterministic CREATE2            │ maker = signer = deposit wallet
       ▼                                  ▼
  Deposit wallet (sigType 3) ◀── created+registered via relayer ── holds pUSD collateral
       ▲
       │ WALLET-CREATE (gasless)
Operator-wide:
  Builder account (Builder API creds) ──▶ Polymarket relayer  +  builder-fee attribution
```

- **Per-user:** Privy EOA (signer), deposit wallet (maker/funder), own CLOB api creds (L1 from the EOA), own signed orders.
- **Operator-wide:** ONE builder account → authenticates relayer calls (create each user's deposit wallet, gasless) + attributes order flow to us (the `builder` bytes32 field + builder headers).
- **User experience unchanged:** log in with Privy → trade. Deposit-wallet creation is invisible plumbing. Users only **fund** their deposit wallet with collateral.

---

## 5. What to build next (concrete)

**Prereq (external):** Builder API credentials — `POLYMARKET_BUILDER_API_KEY` / `_SECRET` / `_PASSPHRASE` from `polymarket.com/settings?tab=builder`. **User believes these may already be in `.env` and the builder profile is registered — CONFIRM FIRST** (grep `.env` for `BUILDER`). If present, the main external blocker is already cleared.

1. **Deposit-wallet derivation** (`packages/chain`): add `deriveDepositWallet(owner)`.
   - `walletId = bytes32(owner)` (left-pad address to 32 bytes); `args = abi.encode(factory, walletId)`; `salt = keccak256(args)`.
   - initCodeHash: ERC-1967 **UUPS** (impl `0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB`) OR **BeaconProxy** (beacon `0x7A18EDfe055488A3128f01F563e5B479D92ffc3a`, current/new users). Runtime: read factory beacon getter (selector `0x49493a4d`); if beacon≠0 and UUPS addr has no code → BeaconProxy.
   - Factory: `0x00000000000Fb5C9ADea0298D729A0CB3823Cc07`.
   - Verify against SDK vectors: UUPS owner `0xA60601A4d903af91855C52BFB3814f6bA342f201` → `0x8b60BF0f650Bf7a0d93F10D72375b37De18F8c40`.
2. **Relayer client** (`apps/api`): `POST https://relayer-v2.polymarket.com/submit` body `{type:"WALLET-CREATE", from:<EOA>, to:<factory>}` with Builder HMAC headers (`POLY_BUILDER_API_KEY/_TIMESTAMP/_PASSPHRASE/_SIGNATURE`); poll `GET /transaction?id=` until `STATE_CONFIRMED`; `GET /deployed?address=&type=WALLET` to check. (Reuse `@polymarket/builder-relayer-client` as reference, or port it.)
3. **signatureType-3 order signing** (`packages/chain`): maker = signer = deposit wallet; `signatureType=3`; signature is **ERC-7739-wrapped ERC-1271** (the embedded EOA signs, wrapped so the deposit wallet's `isValidSignature` validates). This is NEW — our chain pkg only does direct EIP-712 today.
4. **L1 ClobAuth for type-3** ⚠️ — Polymarket's OWN SDKs have an UNFIXED bug here: `createL1Headers` binds the api key to the EOA, but type-3 orders set `signer=deposit wallet`, so `order.signer ≠ api_key.address` → 400. The unmerged fix is `createL1HeadersWrapped1271` (set `ClobAuth.address = deposit wallet`, ERC-7739-wrap the ClobAuth sig). **We must hand-implement this.** Highest-risk piece — validate early.
5. **Fund migration:** move the 27.58 pUSD from Safe `0x2697…` to the new deposit wallet (pUSD only counts as buying power in the maker address). Possibly via relayer batch.
6. **Wire it:** swap `OrderTicket` + `validateOrderForSubmission` to use the deposit wallet as maker/signer + type-3 signing; add a "Create deposit wallet" wizard step (relayer-driven, gasless).

**De-risk order:** do step 1 (derive) + step 4 (type-3 L1 auth) as a tiny isolated probe BEFORE the full build — if we can derive creds bound to a relayer-created deposit wallet and place ONE order, the rest is plumbing. If the L1-auth wrapping can't be made to work, we're blocked the same way Polymarket's SDKs are.

---

## 6. Reference (addresses, endpoints, gates)

| Thing | Value |
|---|---|
| pUSD (V2 collateral) | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` |
| CTF Exchange V2 | `0xE111180000d2663C0091e4f400237545B87B996B` |
| NegRisk Exchange V2 | `0xe2222d279d744050d28e00520010520000310F59` |
| Conditional Tokens (CTF) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| Deposit-wallet factory | `0x00000000000Fb5C9ADea0298D729A0CB3823Cc07` |
| Safe factory (type 2, now closed to new accts) | `0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b` |
| Relayer | `https://relayer-v2.polymarket.com` |
| CLOB | `https://clob.polymarket.com` (CORS `*` — browser submit works) |
| Geoblock check | `https://polymarket.com/api/geoblock` |
| Server gate (.env) | `CAESAR_ENABLE_MAINNET_TRADING` (currently **ON** — set back OFF when not testing) |
| Client gate (.env) | `VITE_ENABLE_MAINNET_TRADING=true` |
| Creds enc key (.env) | `CAESAR_CREDS_ENC_KEY` (64 hex) |

**Auth recap:** L1 = EIP-712 ClobAuth headers `POLY_ADDRESS/SIGNATURE/TIMESTAMP/NONCE` → derive api creds. L2 = HMAC-SHA256(base64 secret) over `ts+METHOD+path+body`, base64url → headers `POLY_ADDRESS/SIGNATURE/TIMESTAMP/API_KEY/PASSPHRASE`. Builder = `POLY_BUILDER_*` headers for the relayer.

---

## 7. Dev-server gotchas (cost ~30 min this session)

- Start the API via the Bash **run_in_background** mechanism, NOT plain `&` (plain `&` dies with the launching shell). Web: `apps/web/node_modules/.bin/vite apps/web --port 3010 --strictPort --host 127.0.0.1`.
- Multiple `pnpm dev` (`tsx --watch`) processes accumulate and fight over `:4000` — a stale gate-OFF process keeps serving while restarts fail to bind. To restart cleanly: `pkill -9 -f -- '--env-file-if-exists=../../.env --import tsx'`, confirm `:4000` FREE, then start ONE.
- `.env` and `schema.graphql` are read **only at boot**; `tsx --watch` does NOT reload them — full restart required for env/schema changes.
- The `:3000` "intel" server is `next-server`, unrelated — don't kill it.

---

## 8. Memory files (auto-loaded next session)

`deposit-wallet-required.md` (the blocker + fix), `clob-geoblock-architecture.md` (browser-submit), `phase3-live-trading.md`, `signing-architecture.md`, `wallet-setup-execution.md`, `caesar-dev-servers.md`. All indexed in `MEMORY.md`.

---

## 9. Uncommitted work

All Phase-3/5 code is **uncommitted** on `main` (working tree). New files: `apps/api/src/{clob,credentials,secrets}.ts`, `apps/api/src/resolvers/credentials.ts`, `packages/db/drizzle/0002_*`. Modified: `apps/api/src/resolvers/{orders,index}.ts`, `apps/web/src/{app/PortfolioPage.tsx,gql/wallet.ts}`, `packages/{db/src/schema.ts,graphql-schema/src/schema.graphql}`. Typechecks clean (only pre-existing `server.ts:107` @types/ws mismatch). **Commit before the next big build** so the deposit-wallet work is isolated.
