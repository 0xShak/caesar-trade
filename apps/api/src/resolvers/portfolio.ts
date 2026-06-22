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
import type { GraphQLContext } from "../auth.js";
import { getDb, users } from "@caesar/db";
import { eq } from "drizzle-orm";

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
