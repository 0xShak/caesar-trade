import { gql } from "@apollo/client";

/**
 * Phase 2 identity operations. `GetMe` resolves null when logged out (or when
 * the Privy token hasn't been attached yet); the onboarding gates read its
 * boolean flags. `SyncTosFromPrivy` records ToS acceptance and returns the
 * refreshed `Me`.
 */

export const GET_ME = gql`
  query GetMe {
    me {
      id
      tosAccepted
      tosVersion
      inviteClaimed
      parityAdmin
      welcomeWizardCompleted
      polymarketTradingAddress
      polymarketWalletKind
      hasServerSigner
      isSafeDeployed
      hasV1Approvals
      hasV2Approvals
      hasApiCredentials
      isWalletSetupComplete
    }
  }
`;

export const SYNC_TOS_FROM_PRIVY = gql`
  mutation SyncTosFromPrivy($acceptTos: Boolean) {
    syncTosFromPrivy(acceptTos: $acceptTos) {
      id
      tosAccepted
      tosVersion
    }
  }
`;
