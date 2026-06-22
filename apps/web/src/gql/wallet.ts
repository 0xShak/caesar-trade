import { gql } from "@apollo/client";

/**
 * Caesar wallet-setup + trading reads. `polymarketAccountState` returns live
 * on-chain ground truth (Safe-deployed, V2 approvals, signer gas, balances) that
 * drives the wallet-setup wizard. Re-fetched after each setup tx to advance steps.
 */
export const POLYMARKET_ACCOUNT_STATE = gql`
  query PolymarketAccountState {
    polymarketAccountState {
      signerAddress
      safeAddress
      isDeployed
      hasV2Approvals
      hasApiCredentials
      signerMaticWei
      pUsdBalance
      usdceBalance
    }
  }
`;
