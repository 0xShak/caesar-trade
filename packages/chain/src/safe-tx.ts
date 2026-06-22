import {
  concatHex,
  encodeFunctionData,
  encodePacked,
  parseSignature,
  size,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { INFRA, type SupportedChainId } from "./addresses.js";
import { requiredApprovals } from "./wallet-setup.js";

/**
 * Pure, offline builders for the two on-chain SETUP transactions a Polymarket
 * Gnosis Safe needs before it can trade (dossier §3–4; spec source-verified from
 * Polymarket's proxy-factories + builder-relayer-client repos):
 *
 *   1. DEPLOY  — the embedded EOA signs a `CreateProxy` EIP-712; any funded
 *      account submits `factory.createProxy(0,0,0, sig)`. The Safe is owned by
 *      the signer regardless of who broadcasts (CREATE2 salt = abi.encode(owner)).
 *   2. APPROVE — the EOA signs a Gnosis `SafeTx` EIP-712 over a MultiSend batch
 *      of all exchange approvals; any funded account submits
 *      `safe.execTransaction(...)` with that signature.
 *
 * Nothing here signs, sends, or touches the network — it only assembles the
 * typed-data to sign and the calldata to broadcast. Signing happens browser-side
 * (the Privy embedded wallet); submission happens from a funded account.
 */

// --- CreateProxy (Safe deploy) ----------------------------------------------

/** EIP-712 domain name of the Polymarket proxy factory (no `version` field). */
export const PROXY_FACTORY_DOMAIN_NAME = "Polymarket Contract Proxy Factory";

export const CREATE_PROXY_TYPE = [
  { name: "paymentToken", type: "address" },
  { name: "payment", type: "uint256" },
  { name: "paymentReceiver", type: "address" },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** CreateProxy domain — `verifyingContract` = the Safe factory. */
export function proxyFactoryDomain(chainId: SupportedChainId): TypedDataDomain {
  return {
    name: PROXY_FACTORY_DOMAIN_NAME,
    chainId,
    verifyingContract: INFRA.safeFactory,
  };
}

/**
 * EIP-712 typed data the embedded EOA signs to authorize a *free* Safe deploy
 * (paymentToken/payment/paymentReceiver all zero). Feed into viem `signTypedData`.
 */
export function buildCreateProxyTypedData(chainId: SupportedChainId) {
  return {
    domain: proxyFactoryDomain(chainId),
    types: { CreateProxy: CREATE_PROXY_TYPE as unknown as readonly { name: string; type: string }[] },
    primaryType: "CreateProxy" as const,
    message: { paymentToken: ZERO_ADDRESS, payment: 0n, paymentReceiver: ZERO_ADDRESS },
  };
}

const CREATE_PROXY_ABI = [
  {
    type: "function",
    name: "createProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
      {
        name: "createSig",
        type: "tuple",
        components: [
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/**
 * Calldata for `factory.createProxy(0,0,0,{v,r,s})` from the EOA's CreateProxy
 * signature. Send to `INFRA.safeFactory`. Deploys the Safe owned by the signer.
 */
export function encodeCreateProxyCall(signature: Hex): Hex {
  const { r, s, v } = parseSignature(signature);
  if (v === undefined) throw new Error("createProxy signature missing v");
  return encodeFunctionData({
    abi: CREATE_PROXY_ABI,
    functionName: "createProxy",
    args: [ZERO_ADDRESS, 0n, ZERO_ADDRESS, { v: Number(v), r, s }],
  });
}

// --- MultiSend batching ------------------------------------------------------

/** One leg of a MultiSend batch. `operation` 0 = CALL, 1 = DELEGATECALL. */
export interface MultiSendTx {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
}

const MULTI_SEND_ABI = [
  {
    type: "function",
    name: "multiSend",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
] as const;

/**
 * Pack legs into the MultiSend `transactions` blob: each leg is
 * `operation(uint8) ‖ to(address) ‖ value(uint256) ‖ dataLength(uint256) ‖ data`.
 */
export function encodeMultiSendTransactions(txs: readonly MultiSendTx[]): Hex {
  return concatHex(
    txs.map((t) =>
      encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [t.operation, t.to, t.value, BigInt(size(t.data)), t.data],
      ),
    ),
  );
}

/** Calldata for `multiSend(bytes)` wrapping the packed legs. */
export function encodeMultiSendCall(txs: readonly MultiSendTx[]): Hex {
  return encodeFunctionData({
    abi: MULTI_SEND_ABI,
    functionName: "multiSend",
    args: [encodeMultiSendTransactions(txs)],
  });
}

/**
 * The single inner Safe transaction (to=MultiSend, DELEGATECALL) that sets every
 * exchange approval for the given version in one shot. Pass to
 * `buildSafeTxTypedData` as the SafeTx payload.
 */
export function buildApprovalMultiSendTx(
  chainId: SupportedChainId,
  version: "v1" | "v2",
): { to: Address; value: bigint; data: Hex; operation: 1 } {
  const legs: MultiSendTx[] = requiredApprovals(chainId, version).map((a) => ({
    to: a.token,
    value: 0n,
    data: a.data,
    operation: 0,
  }));
  return { to: INFRA.multiSend, value: 0n, data: encodeMultiSendCall(legs), operation: 1 };
}

// --- SafeTx (execTransaction) ------------------------------------------------

export const SAFE_TX_TYPE = [
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" },
  { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" },
  { name: "gasToken", type: "address" },
  { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
] as const;

/** Gnosis Safe ≥1.3.0 domain — only `{ chainId, verifyingContract: <safe> }`. */
export function safeTxDomain(chainId: SupportedChainId, safe: Address): TypedDataDomain {
  return { chainId, verifyingContract: safe };
}

export interface SafeTxValue {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
}

export interface SafeTxInput {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  /** Safe's on-chain `nonce()` for this tx (0 for the first tx of a fresh Safe). */
  nonce: bigint;
}

/** Assemble a full SafeTx value with the zero-gas defaults Polymarket uses. */
export function assembleSafeTx(input: SafeTxInput): SafeTxValue {
  return {
    to: input.to,
    value: input.value,
    data: input.data,
    operation: input.operation,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: input.nonce,
  };
}

/** EIP-712 typed data for a SafeTx — feed into viem `signTypedData`. */
export function buildSafeTxTypedData(chainId: SupportedChainId, safe: Address, tx: SafeTxValue) {
  return {
    domain: safeTxDomain(chainId, safe),
    types: { SafeTx: SAFE_TX_TYPE as unknown as readonly { name: string; type: string }[] },
    primaryType: "SafeTx" as const,
    message: tx,
  };
}

const EXEC_TRANSACTION_ABI = [
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

/**
 * Calldata for `safe.execTransaction(...)` carrying the owner's SafeTx signature.
 * A viem `signTypedData` SafeTx signature (v ∈ {27,28}, 65 bytes r‖s‖v) is passed
 * straight through as `signatures` — Gnosis `checkSignatures` ecrecovers it
 * against the SafeTx hash for the default (non-eth_sign) case. Send to the Safe.
 */
export function encodeExecTransaction(tx: SafeTxValue, signature: Hex): Hex {
  return encodeFunctionData({
    abi: EXEC_TRANSACTION_ABI,
    functionName: "execTransaction",
    args: [
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      signature,
    ],
  });
}
