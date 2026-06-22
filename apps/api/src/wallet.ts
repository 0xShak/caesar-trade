/**
 * Shared resolution of the authenticated user's trading wallet — the Privy
 * embedded EOA (signer) + its deterministically-derived Gnosis Safe (funder).
 * Used by the portfolio reads, the wallet-setup flow, and the order mutations so
 * they agree on one source of truth. Pure derivation + a Privy lookup; no chain
 * writes. Returns null when logged out or no embedded wallet is provisioned.
 */
import { deriveTradingWallet, type SignatureType } from "@caesar/chain";
import { isAddress, type Address } from "viem";
import { getEmbeddedWallet, type GraphQLContext } from "./auth.js";

export interface UserTradingWallet {
  /** the Privy embedded EOA that signs orders + setup payloads. */
  signer: Address;
  /** the derived Gnosis Safe that holds collateral (order `maker`/funder). */
  funder: Address;
  signatureType: SignatureType;
}

export async function resolveTradingWallet(
  ctx: GraphQLContext,
): Promise<UserTradingWallet | null> {
  if (!ctx.auth) return null;
  const wallet = await getEmbeddedWallet(ctx.auth);
  if (!wallet || !isAddress(wallet.address)) return null;
  const signer = wallet.address as Address;
  const derived = deriveTradingWallet(signer, "safe");
  return { signer, funder: derived.address, signatureType: derived.signatureType };
}
