import { encodeFunctionData, maxUint256, type Address, type Hex } from "viem";
import { deriveSafe, deriveProxyWallet } from "./safe.js";
import { contractsForChain, type SupportedChainId } from "./addresses.js";
import { SignatureType, CLOB_AUTH_TYPE, CLOB_AUTH_MESSAGE, clobAuthDomain } from "./eip712.js";

/**
 * Polymarket trading-wallet setup — PURE, offline logic (dossier §3 / bible §13).
 *
 * The Privy embedded EOA is the *signer*; a deterministically-derived smart
 * wallet (Gnosis Safe or Polymarket proxy) is the *funder*. Bringing an account
 * to "tradeable" is a fixed sequence of steps. This module owns:
 *   - the step state machine (pure function of the Me boolean flags),
 *   - deterministic funder-address derivation,
 *   - the approval-transaction calldata the funder must execute,
 *   - the EIP-712 ClobAuth payload signed for L1 login.
 *
 * Nothing here touches the network or mainnet. EXECUTING these steps (deploying
 * the Safe, sending approvals, deriving the live CLOB key) is gated behind the
 * §15 mainnet items and cannot be exercised on testnet — there is no Amoy CLOB
 * (see docs/PHASE2-BLOCKERS.md §2).
 */

// --- Step state machine -----------------------------------------------------

export const WalletSetupStep = {
  CONNECT_WALLET: "CONNECT_WALLET", // need the Privy embedded signer
  DEPLOY_SAFE: "DEPLOY_SAFE", // deploy the derived funder Safe
  SET_V1_APPROVALS: "SET_V1_APPROVALS", // USDC + CTF approvals for V1 exchanges
  SET_V2_APPROVALS: "SET_V2_APPROVALS", // ...for V2 exchanges
  DERIVE_API_KEY: "DERIVE_API_KEY", // L1 auth → CLOB api creds (mainnet-gated)
  COMPLETE: "COMPLETE",
} as const;
export type WalletSetupStep = (typeof WalletSetupStep)[keyof typeof WalletSetupStep];

/** Ordered steps a user advances through (excludes the terminal COMPLETE). */
export const WALLET_SETUP_SEQUENCE: readonly WalletSetupStep[] = [
  WalletSetupStep.CONNECT_WALLET,
  WalletSetupStep.DEPLOY_SAFE,
  WalletSetupStep.SET_V1_APPROVALS,
  WalletSetupStep.SET_V2_APPROVALS,
  WalletSetupStep.DERIVE_API_KEY,
];

/** The Me-row flags that drive the state machine. */
export interface WalletSetupFlags {
  hasServerSigner: boolean;
  isSafeDeployed: boolean;
  hasV1Approvals: boolean;
  hasV2Approvals: boolean;
  hasApiCredentials: boolean;
}

/** Map each step to the flag that marks it done. */
function isStepDone(step: WalletSetupStep, f: WalletSetupFlags): boolean {
  switch (step) {
    case WalletSetupStep.CONNECT_WALLET:
      return f.hasServerSigner;
    case WalletSetupStep.DEPLOY_SAFE:
      return f.isSafeDeployed;
    case WalletSetupStep.SET_V1_APPROVALS:
      return f.hasV1Approvals;
    case WalletSetupStep.SET_V2_APPROVALS:
      return f.hasV2Approvals;
    case WalletSetupStep.DERIVE_API_KEY:
      return f.hasApiCredentials;
    case WalletSetupStep.COMPLETE:
      return true;
  }
}

/** The first incomplete step in sequence, or COMPLETE when all are done. */
export function nextSetupStep(flags: WalletSetupFlags): WalletSetupStep {
  for (const step of WALLET_SETUP_SEQUENCE) {
    if (!isStepDone(step, flags)) return step;
  }
  return WalletSetupStep.COMPLETE;
}

export interface WalletSetupProgress {
  step: WalletSetupStep;
  /** 0-based index into WALLET_SETUP_SEQUENCE; equals length when complete. */
  stepIndex: number;
  totalSteps: number;
  completedSteps: WalletSetupStep[];
  isComplete: boolean;
}

/** Full progress snapshot derived from the flags (pure; safe to call per-read). */
export function walletSetupProgress(flags: WalletSetupFlags): WalletSetupProgress {
  const completedSteps = WALLET_SETUP_SEQUENCE.filter((s) => isStepDone(s, flags));
  const step = nextSetupStep(flags);
  const isComplete = step === WalletSetupStep.COMPLETE;
  const stepIndex = isComplete ? WALLET_SETUP_SEQUENCE.length : WALLET_SETUP_SEQUENCE.indexOf(step);
  return {
    step,
    stepIndex,
    totalSteps: WALLET_SETUP_SEQUENCE.length,
    completedSteps,
    isComplete,
  };
}

// --- Funder-wallet derivation -----------------------------------------------

export type TradingWalletKind = "safe" | "proxy";

export interface TradingWallet {
  kind: TradingWalletKind;
  /** Deterministic CREATE2 funder address (predicted; verify before mainnet). */
  address: Address;
  /** Polymarket order SignatureType implied by the funder kind. */
  signatureType: SignatureType;
}

/**
 * Derive the funder wallet for a Privy embedded-EOA owner. Defaults to the
 * Gnosis Safe (POLY_GNOSIS_SAFE) — the kind Privy-signer accounts use. NOTE:
 * the underlying factory + init-code hashes are transcribed from the bundle and
 * carry the verify-before-mainnet caveat (packages/chain/src/addresses.ts).
 */
export function deriveTradingWallet(owner: Address, kind: TradingWalletKind = "safe"): TradingWallet {
  if (kind === "proxy") {
    return { kind, address: deriveProxyWallet(owner), signatureType: SignatureType.POLY_PROXY };
  }
  return { kind: "safe", address: deriveSafe(owner), signatureType: SignatureType.POLY_GNOSIS_SAFE };
}

// --- Approval calldata -------------------------------------------------------

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC1155_SET_APPROVAL_ABI = [
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export type TokenStandard = "erc20" | "erc1155";

export interface ApprovalTx {
  /** Which exchange version this approval enables. */
  version: "v1" | "v2";
  /** Token contract the funder calls (collateral USDC or the CTF ERC1155). */
  token: Address;
  tokenStandard: TokenStandard;
  /** Exchange granted the allowance/operator rights. */
  spender: Address;
  /** Encoded calldata for the funder to execute against `token`. */
  data: Hex;
}

/** ERC20 `approve(spender, MAX_UINT256)` calldata. */
export function encodeErc20Approve(spender: Address, amount: bigint = maxUint256): Hex {
  return encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender, amount] });
}

/** ERC1155 `setApprovalForAll(operator, approved)` calldata. */
export function encodeErc1155SetApprovalForAll(operator: Address, approved = true): Hex {
  return encodeFunctionData({
    abi: ERC1155_SET_APPROVAL_ABI,
    functionName: "setApprovalForAll",
    args: [operator, approved],
  });
}

/**
 * The full set of approval transactions the funder must execute so the CTF
 * exchanges can move its USDC (ERC20) and conditional tokens (ERC1155). V1
 * targets the legacy exchange + negRisk exchange; V2 targets the V2 exchanges.
 * (Spenders come from the chain's address book.)
 */
export function requiredApprovals(chainId: SupportedChainId, version: "v1" | "v2"): ApprovalTx[] {
  const c = contractsForChain(chainId);
  const spenders =
    version === "v1" ? [c.exchange, c.negRiskExchange] : [c.exchangeV2, c.negRiskExchangeV2];

  const txs: ApprovalTx[] = [];
  for (const spender of spenders) {
    txs.push({
      version,
      token: c.collateral,
      tokenStandard: "erc20",
      spender,
      data: encodeErc20Approve(spender),
    });
    txs.push({
      version,
      token: c.conditionalTokens,
      tokenStandard: "erc1155",
      spender,
      data: encodeErc1155SetApprovalForAll(spender),
    });
  }
  return txs;
}

// --- L1 ClobAuth payload -----------------------------------------------------

/**
 * Build the EIP-712 typed-data payload signed for CLOB L1 login (dossier §1.4).
 * The signer is the embedded EOA; `nonce` is typically 0. Pass the result to a
 * viem `signTypedData` to produce the L1 signature.
 */
export function buildClobAuthTypedData(
  address: Address,
  chainId: SupportedChainId,
  timestamp: string,
  nonce = 0n,
) {
  return {
    domain: clobAuthDomain(chainId),
    types: { ClobAuth: CLOB_AUTH_TYPE as unknown as readonly { name: string; type: string }[] },
    primaryType: "ClobAuth" as const,
    message: { address, timestamp, nonce, message: CLOB_AUTH_MESSAGE },
  };
}
