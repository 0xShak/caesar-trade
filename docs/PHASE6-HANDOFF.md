# PHASE 6 — Handoff: Live Trading PROVEN, productionization next

**Date:** 2026-06-22
**Status:** ✅ **Polymarket CLOB V2 live trading works end-to-end.** A real browser-signed, type-3 (deposit-wallet / ERC-1271) GTC order **rested on the live order book** — order id `0x81ed41c79996051ac5722cf8fdc58166c1382f968a199d8edb9ae337bac1083f`. This closes the deposit-wallet blocker that had stopped Phase 3/5. The remaining work is productionization, not protocol unknowns.

---

## TL;DR

- The April-2026 CLOB V2 migration forces new accounts onto **deposit wallets** (signatureType 3, ERC-1271) instead of the old Gnosis Safe (type 2). We built and **proved live** the entire type-3 path.
- Architecture is multi-tenant + browser-signed: the user's Privy embedded EOA signs everything; the server holds **no key** and only orchestrates (validates, injects the user's CLOB api key, computes HMACs, drives the relayer). The order POST is sent **from the user's browser** to dodge the server's geoblocked datacenter IP.
- Everything is **verified against the real contracts/relayer/CLOB**, not assumed: on-chain `isValidSignature`, the relayer protocol, and a live resting order.

---

## The proven architecture (how a trade happens)

```
Privy embedded EOA (the only signer; owns both wallets)
   │   ├─ signs ERC-7739 TypedDataSign  → order (sigType 3)
   │   ├─ signs EIP-712 Batch           → gasless approvals (relayer)
   │   ├─ signs Safe SafeTx             → one-time pUSD migration
   │   └─ signs ClobAuth (L1)           → CLOB api key (BINDS TO THE EOA)
   ▼
Deposit wallet (sigType 3, CREATE2 from EOA)  ── maker == signer of every order
   • relayer-created + registered (gasless), holds pUSD collateral
   • exchange validates orders via maker.isValidSignature (ERC-1271)
Operator-wide: ONE builder profile (POLYMARKET_API_KEY/_SECRET/_PASSPHRASE)
   → authenticates the relayer (wallet create + approval batches), gasless to users
```

Key facts that took reverse-engineering (all confirmed):
- **Derivation:** deposit wallet = `LibClone.deployDeterministicERC1967(impl, args=abi.encode(factory, bytes32(owner)), salt=keccak256(args))`. Reproduced offline (`deriveDepositWalletAddress`), == `factory.predictWalletAddress`.
- **Exchange routing:** `_verifyPoly1271Signature` requires **`signer == maker`** (both = deposit wallet) + `isValidSignatureNow(maker, orderHash, sig)`.
- **Order signature:** Solady ERC-7739 nested EIP-712 — EOA signs `TypedDataSign{contents=orderStructHash, …wallet domain…}` under the **exchange** domain; wire sig = `r‖s‖v ‖ appDomainSep ‖ contents ‖ contentsType ‖ uint16(len)`.
- **CLOB auth binds to the EOA, NOT the deposit wallet.** The L1 endpoint does plain `ecrecover` (a contract/ERC-1271 L1 login 401s). The deposit wallet is associated via relayer registration. Order `owner` = EOA's api key; L2 `POLY_ADDRESS` = EOA. (The handoff-5 "type-3 L1 wrap" idea was a dead end.)
- **Gasless batches** (approvals/sweeps): `execute()` is `onlyFactory`, so they run via relayer `POST /submit {type:"WALLET", from:EOA, to:factory, nonce, signature, depositWalletParams:{depositWallet, deadline, calls}}`; nonce from `GET /nonce?address=<EOA>&type=WALLET`; signature is a plain EIP-712 `Batch` (no ERC-7739 wrap — relayer is a "safe caller").

---

## What's wired (all typechecks clean; chain tests 49/49)

**`packages/chain/src/deposit-wallet.ts`** (+ `deposit-wallet.test.ts`, `deposit-wallet.live.test.ts` [guarded]):
`deriveDepositWalletAddress`, `depositWalletId`, ERC-7739 helpers (`buildType3OrderTypedData`/`assembleType3OrderSignature`, `buildType3ClobAuthTypedData`/`assembleType3ClobAuthSignature` [unused — CLOB L1 is EOA-only]), Batch helpers (`buildDepositWalletApprovalCalls`, `buildErc20TransferCall`, `buildDepositWalletBatchTypedData`, `depositWalletCallsToWire`), domain-separator utils.

**`apps/api`**:
- `relayer.ts` — `loadBuilderCreds`, `createDepositWallet`, `getDepositWalletNonce`, `executeDepositWalletBatch`, `isDepositWalletDeployed`, `waitForDepositWallet` (builder HMAC).
- `resolvers/deposit-wallet.ts` — `createDepositWallet`, `submitDepositWalletApprovals`, `depositWalletNonce`.
- `resolvers/orders.ts` — `validateOrderForSubmission` branches type-3 (maker=signer=deposit wallet; recover inner EOA sig over the TypedDataSign digest). Legacy Safe path preserved.
- `wallet.ts` — `UserTradingWallet` now includes `depositWallet`. `portfolio.ts` + `chain-reads.ts` — `polymarketAccountState` surfaces deposit wallet address/deployed/approvals/balance + `safeNonce` (`readSafeNonce`).
- SDL (`packages/graphql-schema`) + `resolvers/index.ts` wired.

**`apps/web`**:
- `app/PortfolioPage.tsx` — wizard: create deposit wallet → migrate pUSD (Safe execTransaction) → gasless approvals (Batch) → derive EOA creds; plus the **type-3 `OrderTicket`**.
- `gql/wallet.ts` — new docs.

---

## Reference (addresses, endpoints, gates)

| Thing | Value |
|---|---|
| Deposit-wallet factory | `0x00000000000Fb5C9ADea0298D729A0CB3823Cc07` |
| Wallet implementation (`factory.implementation()`) | `0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB` |
| pUSD (V2 collateral) | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` |
| CTF Exchange V2 / NegRisk V2 | `0xE111180000d2663C0091e4f400237545B87B996B` / `0xe2222d279d744050d28e00520010520000310F59` |
| Conditional Tokens (CTF) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| Relayer | `https://relayer-v2.polymarket.com` (types: WALLET-CREATE, WALLET, PROXY, SAFE) |
| CLOB | `https://clob.polymarket.com` (CORS `*`; L1 not geoblocked, `/order` IS) |
| **Test user EOA** | `0xfA1Bc89Fa8D6dA1985672aa03772Eb79567698D7` |
| **Test deposit wallet** | `0x4aE02eae5F4f08075E09aDD163EE9f6dC9A19B4b` |
| Legacy Safe (grandfathered; pUSD source) | `0x2697C609Cf85058c6e20daE0C469a825BB3E1bDB` |
| Builder creds (.env) | `POLYMARKET_API_KEY/_SECRET/_PASSPHRASE` (operator builder profile) |
| Gates (.env) | `CAESAR_ENABLE_MAINNET_TRADING` (server) + `VITE_ENABLE_MAINNET_TRADING` (client) — **set both OFF when not actively trading** |
| Creds enc key (.env) | `CAESAR_CREDS_ENC_KEY` (64 hex) |
| RPC | `POLYGON_RPC_HTTP=https://polygon.drpc.org` (polygon-rpc.com is dead) |

---

## Open items / cleanup before this is production-grade

1. **Turn the gates OFF** when not actively trading (`CAESAR_ENABLE_MAINNET_TRADING`, `VITE_ENABLE_MAINNET_TRADING`).
2. **Commit the work** — it's all uncommitted on `main` (see "Uncommitted" below). Isolate on a branch.
3. **Order ticket is a dev harness** — it lives on the Portfolio page and takes a raw `clobTokenId`. Productionize: integrate a real order ticket into the market-detail page (side/price/size from the orderbook UI, market→tokenId/negRisk wiring).
4. **Order/position management** — list resting orders, fills, positions, cancels. Currently only "cancel last order" in-session.
5. **Server validation is trust-the-user** for the approval Batch (the server rebuilds the standard approval calls but doesn't verify the browser signature before relaying — the relayer/on-chain `execute` rejects bad sigs anyway). Fine for self-serve; revisit for hostile inputs.
6. **`createDepositWallet` resolver blocks up to ~60s** polling for deployment (deploys in ~3s in practice). Consider returning immediately + polling client-side if it ever feels slow.
7. **Pre-existing typecheck noise:** `apps/api/src/server.ts:107` @types/ws v7/v8 mismatch — unrelated, predates this work.
8. **Dev-server gotcha:** `.env` + `schema.graphql` are read only at boot; `tsx --watch` does NOT reload them — full API restart after SDL/env changes (this caused a transient 500 when the API was simply down). See [[caesar-dev-servers]].

---

## Suggested next phase (candidates)

- **Trade UX on market pages** — wire the proven type-3 order path into the real market-detail orderbook/ticket; remove the Portfolio dev harness.
- **Portfolio/positions** — read deposit-wallet positions (CTF balances), open orders, P&L.
- **Onboarding polish** — the 4-step wizard is functional; make it a smooth first-run flow (auto-create deposit wallet on first trade, clearer funding UX).
- **Kalshi** — still public-data-only (no phone to register; see [[kalshi-auth-skipped]]).

---

## Uncommitted work

Everything from this session is on `main`, working tree. New: `packages/chain/src/deposit-wallet.ts` (+2 tests), `apps/api/src/relayer.ts`, `apps/api/src/resolvers/deposit-wallet.ts`. Modified: `packages/chain/src/index.ts`, `apps/api/src/{wallet,chain-reads}.ts`, `apps/api/src/resolvers/{orders,portfolio,index}.ts`, `packages/graphql-schema/src/schema.graphql`, `apps/web/src/app/PortfolioPage.tsx`, `apps/web/src/gql/wallet.ts`. Plus prior uncommitted Phase 3/5 work (see PHASE5-HANDOFF.md §9). **Commit before the next phase.**

---

## Memory files (auto-loaded next session)

`deposit-wallet-required.md` (full proven architecture + addresses), `phase3-live-trading.md`, `clob-geoblock-architecture.md`, `signing-architecture.md`, `caesar-dev-servers.md`, `project-stage.md`. All indexed in `MEMORY.md`.
