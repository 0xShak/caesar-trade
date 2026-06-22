# Phase 3 — Live trading (browser-signed) · build + runbook

Status as of 2026-06-22. This is the live-trading build that turns the gated
plumbing into real orders. **Architecture decided + half-built; live fire pending
a funded signer + a supervised run.**

## Architecture (decided 2026-06-22)

**Browser-signed, server-orchestrated, multi-tenant.** Every signature (Safe
deploy, approvals, ClobAuth, order) is produced **in-browser by the user's Privy
embedded wallet**; the user approves each one. The server holds **no private key**
— it only reads chain state, derives + stores per-user CLOB creds, and submits
signed orders with L2 HMAC. Each customer trades from their own embedded wallet →
their own derived Gnosis Safe, with no per-user secrets server-side.

Why browser-signed (not Privy server-delegated): matches Polymarket's real
architecture (the client only signs EIP-712), safest for real money, no extra
Privy config, fastest to a live order. Server-delegated signing is the deferred
path for future automations.

## Gas / deploy model (source-verified)

- Polymarket's gasless relayer (`relayer-v2.polymarket.com/submit`) needs
  **builder HMAC API creds** we don't have (builder *code* ≠ builder *API creds*).
  Blocked → revisit for production gasless UX.
- So setup is **self-executed**: the embedded EOA signs AND submits `createProxy`
  (deploy) + `execTransaction` (approvals), paying its own gas. The EOA needs a
  little MATIC (~1 is plenty; ~$0.05 actual).
- Safe factory `createProxy(paymentToken,payment,paymentReceiver,(v,r,s))` is
  permissionless; the Safe is owned by the CreateProxy signer regardless of who
  broadcasts. Approvals batch via Gnosis MultiSend (1.3.0) in one execTransaction.

## What's built (this session)

| Piece | Where | State |
|---|---|---|
| On-chain read layer (deployed / balances / approvals) | `apps/api/src/chain-reads.ts` | ✅ live-verified |
| `walletBalance` + `polymarketAccountState` resolvers | `apps/api/src/resolvers/portfolio.ts` | ✅ |
| Pure deploy/approval builders (CreateProxy, SafeTx, MultiSend, execTransaction) | `packages/chain/src/safe-tx.ts` | ✅ 10 offline tests |
| Browser sign+send hook (Privy embedded → viem on Polygon) | `apps/web/src/lib/tradingWallet.ts` | ✅ typechecks + prod-builds |
| Wallet-setup wizard (deploy + approvals, gated) | `apps/web/src/app/PortfolioPage.tsx` | ✅ built; live-unverified |
| CLOB creds store + derive (L1) | — | ⬜ TODO (Task #3) |
| Order submit (L2 HMAC → /order) | `apps/api/src/resolvers/orders.ts` (`submitToClob` stub) | ⬜ gated stub |
| Order-ticket UI | market detail | ⬜ TODO |

## Live-fire runbook (deploy → approve → derive → $1 order)

Pre-req: test Safe `0x2697C609…` funded ($27.59 pUSD ✓, 15 MATIC ✓); **signer EOA
`0xfA1Bc89F…` funded with ~1 MATIC** (gas — currently 0).

1. In root `.env`, set **both** `CAESAR_ENABLE_MAINNET_TRADING=true` and
   `VITE_ENABLE_MAINNET_TRADING=true`. Restart API + Vite (env is inlined at boot).
2. Log in (test account), open Portfolio. Confirm signer shows MATIC > 0.
3. **Deploy Safe** → approve the Privy signature + tx. Wait for "Safe deployed".
   Verify on-chain: `getBytecode(safe) !== 0x`.
4. **Set V2 approvals** → approve. Wait for "V2 approvals set".
5. Derive CLOB creds (Task #3) → place one ~$1 order on an active Polymarket
   market → verify fill/cancel. Then flip both flags back OFF.

**Hard rule:** flags stay OFF except during a supervised live run. The server
`submitToClob` throws unless `CAESAR_ENABLE_MAINNET_TRADING=true`.
