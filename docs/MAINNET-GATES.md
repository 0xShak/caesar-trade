# Verify-before-mainnet gates — research log

The §15 gates that must be resolved before trading real funds (Phase 3). Status
as of 2026-06-22. Researched from Polymarket docs + PolygonScan; items still
marked UNVERIFIED need live confirmation (a funded mainnet account or Polymarket
support) and must NOT be assumed.

## 1. Collateral token — ✅ RESOLVED (was "COLLATERAL_HAZARD")
`0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` is **NOT a placeholder**. It is the
real **pUSD** ("Polymarket USD") token — collateral for the **CLOB V2** stack on
Polygon mainnet (ERC-20, ~$484M supply, EIP-1167 minimal-proxy; PolygonScan
labels it "Polymarket: pUSD Token").
- pUSD is **backed by USDC.e** (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`),
  wrapped/unwrapped via CollateralOnramp `0x93070a847efEf7F70739046A929D47a521F5B8ee`.
- **V1** exchange (`0x4bFb41d5…82E`) traded directly in **USDC.e**;
  **V2** exchange (`0xE111180000d2663C0091e4f400237545B87B996B`) uses **pUSD**.
- Code updated: `packages/chain/src/addresses.ts` → `COLLATERAL_PUSD_V2`
  (`COLLATERAL_PLACEHOLDER` kept as a deprecated alias).
- **Still verify:** token decimals + approval semantics against the live
  contract; the **Amoy/testnet pUSD address** (the bundle reuses the mainnet
  address for Amoy — UNVERIFIED).
- Sources: docs.polymarket.com/concepts/pusd, /resources/contracts, PolygonScan.

## 2. Builder code / builder fees — ◑ DOCUMENTED, flow partially unverified
Polymarket's **Builder Program is live**. A builder code is a **`bytes32`**
attributing routed orders to a builder profile.
- **Registration:** UI — create a builder profile at
  `polymarket.com/settings?tab=builder`, copy the `bytes32` code. The bundle's
  REST endpoints (`/auth/builder-api-key`, `/fees/builder-fees/<code>`) are
  **NOT confirmed in public docs** (likely internal/older) — confirm with
  Polymarket support before relying on them.
- **Fees:** set in-profile — `builder_taker_fee_bps` (≤100), `builder_maker_fee_bps`
  (≤50); `fee = notional × bps/1e4`. Read via SDK `getClobMarketInfo()`
  (`info.tbf`/`info.mbf`).
- **Order struct:** the V2 EIP-712 order's `builder` (bytes32) field carries it
  (matches `CTF_EXCHANGE_V2_ORDER` in `packages/chain/src/eip712.ts`); omit/zero
  = no builder fee.
- Sources: docs.polymarket.com/builders/{overview,api-keys,fees}.

## 3. Kalshi RSA-PSS signing scheme — ⛔ BLOCKED (no demo creds)
Confirming the RSA-PSS request-signing scheme against Kalshi's official example
needs a demo API key + RSA PEM. The user has **no phone number** to register with
Kalshi (see memory `kalshi-auth-skipped`), so this stays deferred. Kalshi public
market data ingests fine without it; only Kalshi *trading* is affected.

## 4. Amoy CLOB reality — ✅ RESOLVED (no testnet CLOB)
There is no Polymarket CLOB on Amoy testnet — mainnet-only. See
`docs/PHASE2-BLOCKERS.md §2`. Wallet-setup is built/tested offline; live CLOB
steps are mainnet-only.

---
**Net:** gates 1 and 4 resolved; gate 2 mostly understood (use the `bytes32`
`builder` field; UI registration; confirm bundle endpoints with support); gate 3
blocked on Kalshi registration (no phone). None of this changes the standing rule:
**do not trade real funds** until 1–2 are confirmed live and the code paths are
exercised on a funded mainnet dry-run.
