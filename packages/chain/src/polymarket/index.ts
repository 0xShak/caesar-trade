/**
 * ethers-v5-SCOPED Polymarket CLOB wrapper.
 *
 * ethers v5 is QUARANTINED to this directory because `@polymarket/clob-client`
 * needs an ethers `Signer`. Everything else in the monorepo uses viem. The
 * exported `recoverV2OrderSigner` + `buildL2HmacSignature` helpers are PURE
 * (viem / node:crypto) and carry no ethers dependency.
 *
 * Source of truth: /root/parity-study/dossier-onchain-signing.md §1, §5.
 */
import { createHmac } from "node:crypto";
import { Wallet } from "ethers";
import { ClobClient } from "@polymarket/clob-client";
import {
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { CTF_EXCHANGE_V2_ORDER, type OrderV2Value } from "../eip712.js";
import type { SupportedChainId } from "../addresses.js";
import type { SignatureType } from "../eip712.js";

export interface CreateClobClientParams {
  host: string;
  chainId: SupportedChainId;
  privateKey: string;
  funderAddress: Address;
  signatureType: SignatureType;
}

/**
 * Construct a `@polymarket/clob-client` ClobClient backed by an ethers v5
 * Wallet signer. Mirrors dossier §5.1:
 *   new ClobClient({ host, chain, signer, signatureType, funderAddress })
 *
 * Note: clob-client v4's ClobClient is a positional-arg constructor in some
 * builds — we use the object form documented in the bundle. If the installed
 * v4 surface differs, the lead must verify the constructor signature at run
 * time (see report).
 */
export function createClobClient(params: CreateClobClientParams): ClobClient {
  const { host, chainId, privateKey, funderAddress, signatureType } = params;
  const signer = new Wallet(privateKey);
  // The bundle uses the object form. Cast keeps us tolerant to v4 typing drift.
  return new ClobClient(
    host,
    chainId as number,
    signer,
    undefined,
    signatureType as number,
    funderAddress,
  );
}

/** L1-auth → derive (or create) the CLOB API credential triple. */
export async function deriveApiCreds(
  client: ClobClient,
): Promise<{ key: string; secret: string; passphrase: string }> {
  const creds = await client.createOrDeriveApiKey();
  return {
    key: creds.key,
    secret: creds.secret,
    passphrase: creds.passphrase,
  };
}

export interface RecoverV2Params {
  domain: TypedDataDomain;
  order: OrderV2Value;
  signature: Hex;
}

/**
 * PURE viem signature-verify (the Phase-0 hard gate). Recovers the EOA that
 * signed a V2 order's EIP-712 typed data. Compare (case-insensitively) against
 * the expected `signer` to prove the signature is valid.
 */
export async function recoverV2OrderSigner(params: RecoverV2Params): Promise<Address> {
  const { domain, order, signature } = params;
  return recoverTypedDataAddress({
    domain,
    types: { Order: CTF_EXCHANGE_V2_ORDER as unknown as readonly { name: string; type: string }[] },
    primaryType: "Order",
    message: {
      salt: order.salt,
      maker: order.maker,
      signer: order.signer,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      side: order.side,
      signatureType: order.signatureType,
      timestamp: order.timestamp,
      metadata: order.metadata,
      builder: order.builder,
    },
    signature,
  });
}

/**
 * L2 per-request HMAC signature (dossier §5.4). VERBATIM:
 *   msg = ts + METHOD + path (+ body)
 *   key = base64-decode(secret)
 *   HMAC-SHA256 → base64 → base64url (+→-, /→_)
 */
export function buildL2HmacSignature(
  secret: string,
  timestamp: string | number,
  method: string,
  path: string,
  body?: string,
): string {
  let msg = `${timestamp}${method}${path}`;
  if (body !== undefined) msg += body;
  const key = Buffer.from(secret, "base64");
  const sig = createHmac("sha256", key).update(msg).digest("base64");
  return sig.replaceAll("+", "-").replaceAll("/", "_");
}
