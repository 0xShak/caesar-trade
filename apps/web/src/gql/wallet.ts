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
      safeNonce
      depositWalletAddress
      depositWalletDeployed
      depositHasApprovals
      depositPUsdBalance
    }
  }
`;

/** Current Batch nonce for the user's deposit wallet (browser signs approvals with it). */
export const DEPOSIT_WALLET_NONCE = gql`
  query DepositWalletNonce {
    depositWalletNonce
  }
`;

/** Relayer-driven, gasless creation of the user's CLOB V2 deposit wallet. */
export const CREATE_DEPOSIT_WALLET = gql`
  mutation CreateDepositWallet {
    createDepositWallet {
      success
      address
      deployed
      transactionHash
      error
    }
  }
`;

/** Submit the browser-signed Batch of the four V2 approvals (gasless via relayer). */
export const SUBMIT_DEPOSIT_WALLET_APPROVALS = gql`
  mutation SubmitDepositWalletApprovals($input: SubmitDepositWalletApprovalsInput!) {
    submitDepositWalletApprovals(input: $input) {
      success
      transactionHash
      error
    }
  }
`;

/** Derive + persist (encrypted) the user's CLOB API creds from a browser ClobAuth sig. */
export const DERIVE_POLYMARKET_CREDENTIALS = gql`
  mutation DerivePolymarketApiCredentials($input: DerivePolymarketCredentialsInput!) {
    derivePolymarketApiCredentials(input: $input) {
      success
      error
    }
  }
`;

/** Submit a fully browser-signed V2 order (server injects creds + L2 HMAC). */
export const SUBMIT_POLYMARKET_ORDER = gql`
  mutation SubmitPolymarketOrder($input: SignedPolymarketOrderInput!) {
    submitPolymarketOrder(input: $input) {
      success
      status
      platformOrderId
      error
    }
  }
`;

/** Cancel a resting order by its CLOB order id. */
export const CANCEL_POLYMARKET_ORDER = gql`
  mutation CancelPolymarketOrder($orderId: String!) {
    cancelPolymarketOrder(orderId: $orderId) {
      success
      status
      platformOrderId
      error
    }
  }
`;

/**
 * Browser-submit: ask the server to validate + authenticate the order and return
 * the signed request, which the BROWSER then fetches directly against the CLOB
 * (so the trading POST comes from the user's IP, not the server's geoblocked one).
 */
export const PREPARE_POLYMARKET_ORDER = gql`
  mutation PreparePolymarketOrder($input: SignedPolymarketOrderInput!) {
    preparePolymarketOrder(input: $input) {
      success
      error
      url
      method
      headers {
        name
        value
      }
      body
    }
  }
`;

/** Browser-submit cancel: server returns the signed DELETE for the client to send. */
export const PREPARE_POLYMARKET_CANCEL = gql`
  mutation PreparePolymarketCancel($orderId: String!) {
    preparePolymarketCancel(orderId: $orderId) {
      success
      error
      url
      method
      headers {
        name
        value
      }
      body
    }
  }
`;
