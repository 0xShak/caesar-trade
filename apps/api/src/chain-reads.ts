/**
 * On-chain READ layer for Polymarket trading wallets (Polygon mainnet). Pure
 * reads — balances, Safe-deployment status, and exchange approvals — surfaced so
 * the portfolio views + wallet-setup wizard reflect ground truth instead of
 * trusting the cached DB flags. No writes, no signing; safe with the mainnet gate
 * OFF. The RPC is POLYGON_RPC_HTTP (see @caesar/config).
 */
import { loadEnv } from "@caesar/config";
import {
  publicClientFor,
  POLYGON_CHAIN_ID,
  COLLATERAL_PUSD_V2,
  CANONICAL_USDC_E_POLYGON,
  MATIC_CONTRACTS,
} from "@caesar/chain";
import { erc20Abi, type Abi, type Address, type PublicClient } from "viem";

let cached: PublicClient | null = null;

/** Memoized Polygon public client (POLYGON_RPC_HTTP). */
export function polygonClient(): PublicClient {
  if (!cached) cached = publicClientFor(POLYGON_CHAIN_ID, loadEnv().POLYGON_RPC_HTTP);
  return cached;
}

const ERC1155_IS_APPROVED_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

/** On-chain base units (6 dp) → dollar Float (the SDL Wallet wire-contract). */
export function baseUnitsToUsd(base: bigint): number {
  return Number(base) / 1e6;
}

export interface WalletState {
  /** Safe has bytecode on-chain (counterfactual until deployed). */
  isDeployed: boolean;
  /** raw on-chain balances of the Safe, base units (pUSD/USDC.e = 6 dp; matic = wei). */
  pusd: bigint;
  usdce: bigint;
  matic: bigint;
  /** V2 exchange approvals set from the Safe (enough to trade on CLOB V2). */
  approvals: {
    pusdExchangeV2: boolean;
    pusdNegRiskExchangeV2: boolean;
    ctfExchangeV2: boolean;
    ctfNegRiskExchangeV2: boolean;
  };
}

/**
 * Read the full trading-readiness state of a Safe in one round-trip (multicall +
 * two node calls). `allowFailure` keeps a flaky token read from sinking the whole
 * snapshot — a failed leg reads as zero/false rather than throwing.
 */
export async function readWalletState(safe: Address): Promise<WalletState> {
  const c = polygonClient();
  const { exchangeV2, negRiskExchangeV2, conditionalTokens } = MATIC_CONTRACTS;

  const [code, matic, multi] = await Promise.all([
    c.getBytecode({ address: safe }),
    c.getBalance({ address: safe }),
    c.multicall({
      allowFailure: true,
      contracts: [
        { address: COLLATERAL_PUSD_V2, abi: erc20Abi, functionName: "balanceOf", args: [safe] },
        { address: CANONICAL_USDC_E_POLYGON, abi: erc20Abi, functionName: "balanceOf", args: [safe] },
        { address: COLLATERAL_PUSD_V2, abi: erc20Abi, functionName: "allowance", args: [safe, exchangeV2] },
        { address: COLLATERAL_PUSD_V2, abi: erc20Abi, functionName: "allowance", args: [safe, negRiskExchangeV2] },
        { address: conditionalTokens, abi: ERC1155_IS_APPROVED_ABI, functionName: "isApprovedForAll", args: [safe, exchangeV2] },
        { address: conditionalTokens, abi: ERC1155_IS_APPROVED_ABI, functionName: "isApprovedForAll", args: [safe, negRiskExchangeV2] },
      ],
    }),
  ]);

  const big = (i: number): bigint =>
    multi[i]?.status === "success" ? (multi[i].result as bigint) : 0n;
  const flag = (i: number): boolean =>
    multi[i]?.status === "success" ? Boolean(multi[i].result) : false;

  return {
    isDeployed: !!code && code !== "0x",
    pusd: big(0),
    usdce: big(1),
    matic,
    approvals: {
      // We always approve max; any positive allowance means the approval is set.
      pusdExchangeV2: big(2) > 0n,
      pusdNegRiskExchangeV2: big(3) > 0n,
      ctfExchangeV2: flag(4),
      ctfNegRiskExchangeV2: flag(5),
    },
  };
}

const SAFE_NONCE_ABI = [
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const satisfies Abi;

/**
 * The Safe's current on-chain `nonce()` (needed to sign the next execTransaction,
 * e.g. migrating pUSD out to the deposit wallet). Returns 0 if undeployed/unreadable.
 */
export async function readSafeNonce(safe: Address): Promise<bigint> {
  try {
    return await polygonClient().readContract({
      address: safe,
      abi: SAFE_NONCE_ABI,
      functionName: "nonce",
    });
  } catch {
    return 0n;
  }
}

/** True when all four V2 approvals (collateral + CTF, both exchanges) are set. */
export function hasV2ApprovalsSet(s: WalletState): boolean {
  return (
    s.approvals.pusdExchangeV2 &&
    s.approvals.pusdNegRiskExchangeV2 &&
    s.approvals.ctfExchangeV2 &&
    s.approvals.ctfNegRiskExchangeV2
  );
}
