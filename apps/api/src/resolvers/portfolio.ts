/**
 * Portfolio read resolvers (Track 1). These are public-data / chain READS keyed
 * to the authenticated user's derived Safe — no signing, no mainnet gate.
 *
 * `walletBalance` reads the Safe's on-chain pUSD + USDC.e balances (the V2 vs V1
 * collateral) via `readWalletState`. Balances surface as dollar Floats (base
 * units / 1e6), matching the SDL `Wallet` wire-contract. Returns null when logged
 * out / no embedded wallet yet.
 */
import { baseUnitsToUsd, hasV2ApprovalsSet, polygonClient, readSafeNonce, readWalletState } from "../chain-reads.js";
import { resolveTradingWallet } from "../wallet.js";
import { loadCredentials } from "../credentials.js";
import { getOpenOrders, type RawOpenOrder } from "../clob.js";
import type { GraphQLContext } from "../auth.js";
import { getDb, users } from "@caesar/db";
import { eq } from "drizzle-orm";

const POLY_DATA_API = "https://data-api.polymarket.com";

/** Fetch + parse JSON with a timeout; null on any failure (mirrors traders.ts). */
async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read the persisted `hasApiCredentials` flag for the authenticated user. */
async function hasApiCredentialsForUser(ctx: GraphQLContext): Promise<boolean> {
  if (!ctx.auth) return false;
  const rows = await getDb()
    .select({ has: users.hasApiCredentials })
    .from(users)
    .where(eq(users.id, ctx.auth.userId))
    .limit(1);
  return rows[0]?.has ?? false;
}

/**
 * Live trading-readiness of the user's Safe — Safe-deployed, V2 approvals, and
 * the signer's gas balance, all read on-chain (ground truth for the wallet-setup
 * wizard). `hasApiCredentials` comes from the DB (set once creds are derived).
 */
export async function resolvePolymarketAccountState(ctx: GraphQLContext) {
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return null;

  const [state, depositState, safeNonce, signerMaticWei, hasApiCredentials] = await Promise.all([
    readWalletState(wallet.funder),
    readWalletState(wallet.depositWallet),
    readSafeNonce(wallet.funder),
    polygonClient().getBalance({ address: wallet.signer }),
    hasApiCredentialsForUser(ctx),
  ]);

  return {
    signerAddress: wallet.signer,
    safeAddress: wallet.funder,
    isDeployed: state.isDeployed,
    hasV2Approvals: hasV2ApprovalsSet(state),
    hasApiCredentials,
    signerMaticWei: signerMaticWei.toString(),
    pUsdBalance: baseUnitsToUsd(state.pusd),
    usdceBalance: baseUnitsToUsd(state.usdce),
    safeNonce: safeNonce.toString(),
    // CLOB V2 deposit wallet (the trading wallet now).
    depositWalletAddress: wallet.depositWallet,
    depositWalletDeployed: depositState.isDeployed,
    depositHasApprovals: hasV2ApprovalsSet(depositState),
    depositPUsdBalance: baseUnitsToUsd(depositState.pusd),
  };
}

export async function resolveWalletBalance(ctx: GraphQLContext) {
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return null;

  const state = await readWalletState(wallet.funder);
  const pUsd = baseUnitsToUsd(state.pusd);
  const usdce = baseUnitsToUsd(state.usdce);

  return {
    wallets: [
      {
        address: wallet.funder,
        balances: {
          polygon: {
            pUsdBalance: pUsd,
            pUsdError: null,
            usdceBalance: usdce,
            usdceError: null,
            usdcBalance: 0,
            usdcError: null,
          },
        },
        totalPUsdBalance: pUsd,
        totalUsdceBalance: usdce,
        totalUsdcBalance: 0,
        availableUsdceBalance: usdce,
      },
    ],
  };
}

/** data-api position row (the fields we surface). */
interface PolyPositionRow {
  asset?: string | null;
  conditionId?: string | null;
  title?: string | null;
  outcome?: string | null;
  size?: number | null;
  avgPrice?: number | null;
  curPrice?: number | null;
  initialValue?: number | null;
  currentValue?: number | null;
  cashPnl?: number | null;
  percentPnl?: number | null;
  redeemable?: boolean | null;
}

/**
 * Live positions held by the user's CLOB V2 deposit wallet, via the public
 * Polymarket data-api (`/positions?user=`) — the same endpoint `traders.ts` uses
 * server-side. Dollars + 0..1 prices, newest/biggest first. No mainnet gate (read
 * only); returns [] when logged out / no wallet / nothing held.
 */
export async function resolvePolymarketPositions(ctx: GraphQLContext) {
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return [];
  const url = `${POLY_DATA_API}/positions?user=${encodeURIComponent(
    wallet.depositWallet,
  )}&limit=200&sortBy=CURRENT&sortDirection=DESC`;
  const rows = await fetchJson<PolyPositionRow[]>(url);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((p) => !!p.asset && Number(p.size ?? 0) > 0)
    .map((p) => ({
      asset: p.asset!,
      conditionId: p.conditionId ?? null,
      title: p.title ?? null,
      outcome: p.outcome ?? null,
      size: Number(p.size ?? 0),
      avgPrice: p.avgPrice ?? null,
      curPrice: p.curPrice ?? null,
      initialValue: p.initialValue ?? null,
      currentValue: p.currentValue ?? null,
      cashPnl: p.cashPnl ?? null,
      percentPnl: p.percentPnl ?? null,
      redeemable: p.redeemable ?? null,
    }));
}

/** Parse a numeric string from the CLOB (decimal string) → number | null. */
function numOrNull(s: string | number | undefined | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * The authenticated user's resting (open) orders from the CLOB
 * (`GET /data/orders`). Read-only and ungated — shows live orders whenever the
 * user has CLOB creds. Returns [] when logged out / no creds / none open.
 */
export async function resolvePolymarketOpenOrders(ctx: GraphQLContext) {
  if (!ctx.auth) return [];
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return [];
  const creds = (await loadCredentials(ctx.auth.userId))?.creds;
  if (!creds) return [];

  const res = await getOpenOrders(wallet.signer, creds);
  if (!res.ok || !Array.isArray(res.body)) return [];
  return (res.body as RawOpenOrder[])
    .filter((o) => !!o.id)
    .map((o) => {
      const original = numOrNull(o.original_size);
      const matched = numOrNull(o.size_matched);
      const remaining = original != null ? original - (matched ?? 0) : null;
      return {
        id: o.id!,
        status: o.status ?? null,
        conditionId: o.market ?? null,
        assetId: o.asset_id ?? null,
        outcome: o.outcome ?? null,
        side: o.side ?? null,
        price: numOrNull(o.price),
        originalSize: original,
        sizeMatched: matched,
        sizeRemaining: remaining,
        orderType: o.order_type ?? null,
        createdAt: o.created_at != null ? String(o.created_at) : null,
      };
    });
}
