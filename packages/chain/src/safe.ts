import {
  encodeAbiParameters,
  encodePacked,
  getCreate2Address,
  keccak256,
  type Address,
} from "viem";
import { INFRA, PROXY_INIT_CODE_HASH, SAFE_INIT_CODE_HASH } from "./addresses.js";

/**
 * Deterministic per-user wallet derivation (CREATE2) — dossier §3.1.
 * Each Privy EOA maps to exactly one Safe / proxy-wallet address.
 */

/** Gnosis-Safe address: salt = keccak256(abi.encode(owner)) (ABI-encoded → 32 bytes). */
export function deriveSafe(owner: Address): Address {
  const salt = keccak256(encodeAbiParameters([{ name: "owner", type: "address" }], [owner]));
  return getCreate2Address({
    from: INFRA.safeFactory,
    salt,
    bytecodeHash: SAFE_INIT_CODE_HASH,
  });
}

/** Polymarket proxy-wallet address: salt = keccak256(encodePacked(["address"],[owner])) (20 bytes). */
export function deriveProxyWallet(owner: Address): Address {
  const salt = keccak256(encodePacked(["address"], [owner]));
  return getCreate2Address({
    from: INFRA.proxyFactory,
    salt,
    bytecodeHash: PROXY_INIT_CODE_HASH,
  });
}
