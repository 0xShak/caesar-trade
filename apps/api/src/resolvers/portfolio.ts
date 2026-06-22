/**
 * Portfolio read resolvers (Track 1). These are public-data / chain READS keyed
 * to the authenticated user's derived Safe — no signing, no mainnet gate.
 *
 * `walletBalance` reads the Safe's on-chain pUSD + USDC.e balances (the V2 vs V1
 * collateral) via `readWalletState`. Balances surface as dollar Floats (base
 * units / 1e6), matching the SDL `Wallet` wire-contract. Returns null when logged
 * out / no embedded wallet yet.
 */
import { baseUnitsToUsd, readWalletState } from "../chain-reads.js";
import { resolveTradingWallet } from "../wallet.js";
import type { GraphQLContext } from "../auth.js";

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
