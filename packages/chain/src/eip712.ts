import type { Address, TypedDataDomain } from "viem";
import type { SupportedChainId } from "./addresses.js";

/**
 * EIP-712 typed data for Polymarket CLOB — transcribed VERBATIM from
 * dossier-onchain-signing.md §1. [CONFIRMED] from the bundle.
 *
 * V1  = legacy CTF Exchange (domain version "1"): Order carries nonce + feeRateBps.
 * V2  = CLOB_V2, builder-enabled (domain version "2"): drops taker/expiration/nonce/
 *       feeRateBps from the SIGNED struct, adds timestamp/metadata/builder.
 */

// --- SignatureType enums (dossier §1.6) -------------------------------------
export const SignatureType = {
  EOA: 0,
  POLY_PROXY: 1,
  POLY_GNOSIS_SAFE: 2,
  POLY_1271: 3, // V2 only
} as const;
export type SignatureType = (typeof SignatureType)[keyof typeof SignatureType];

// --- Side encoding (BUY=0, SELL=1) ------------------------------------------
export const OrderSide = { BUY: 0, SELL: 1 } as const;
export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];

// --- Struct field definitions (viem TypedData shape) ------------------------
export const CTF_EXCHANGE_V1_ORDER = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "taker", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "expiration", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "feeRateBps", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
] as const;

export const CTF_EXCHANGE_V2_ORDER = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
  { name: "timestamp", type: "uint256" },
  { name: "metadata", type: "bytes32" }, // default 0x00..00
  { name: "builder", type: "bytes32" }, // builderCode; default 0x00..00 (= no builder)
] as const;

export const CLOB_AUTH_TYPE = [
  { name: "address", type: "address" },
  { name: "timestamp", type: "string" },
  { name: "nonce", type: "uint256" },
  { name: "message", type: "string" },
] as const;

/** L1 login message that must be signed verbatim (dossier §1.4). */
export const CLOB_AUTH_MESSAGE = "This message attests that I control the given wallet";

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

// --- Domain builders --------------------------------------------------------

/** CTF Exchange order domain. `verifyingContract` = the exchange (or negRisk) address. */
export function orderDomain(
  version: "1" | "2",
  chainId: SupportedChainId,
  verifyingContract: Address,
): TypedDataDomain {
  return { name: "Polymarket CTF Exchange", version, chainId, verifyingContract };
}

/** ClobAuth domain — note: NO verifyingContract (dossier §1.4). */
export function clobAuthDomain(chainId: SupportedChainId): TypedDataDomain {
  return { name: "ClobAuthDomain", version: "1", chainId };
}

// --- Order value shapes (the message payload, not the type) -----------------

export interface OrderV2Value {
  salt: bigint;
  maker: Address;
  signer: Address;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  side: OrderSide;
  signatureType: SignatureType;
  timestamp: bigint;
  metadata: `0x${string}`;
  builder: `0x${string}`;
}

/** generateOrderSalt() per the bundle: String(Math.round(Math.random()*Date.now())). */
export function generateOrderSalt(randomSeed: number, nowMs: number): bigint {
  return BigInt(Math.round(randomSeed * nowMs));
}
