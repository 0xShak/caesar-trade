/**
 * Polymarket **relayer** client — gasless, builder-authenticated deposit-wallet
 * creation (CLOB V2, signatureType 3).
 *
 * New V2 API accounts must trade from a relayer-created, server-registered
 * "deposit wallet" (a Solady ERC-1967 + ERC-1271 smart wallet), NOT a
 * self-deployed Gnosis Safe (grandfathered-only). The relayer is the operator
 * on the DepositWalletFactory: given a WALLET-CREATE request authenticated with
 * our **builder** API credentials, it deploys + registers the user's deposit
 * wallet (deterministic from their Privy EOA) at no cost to the user.
 *
 * VERIFIED end-to-end on Polygon mainnet (2026-06-22): authenticated submit
 * returns STATE_NEW + a tx hash; the wallet is deployed within seconds; the
 * derived address (see @caesar/chain `deriveDepositWalletAddress`) matches the
 * deployed contract, and its on-chain ERC-1271 `isValidSignature` accepts our
 * type-3 order + ClobAuth signatures.
 *
 * Auth: builder HMAC headers, identical mechanics to the CLOB L2 HMAC
 * (`buildL2HmacSignature`) but with `POLY_BUILDER_*` header names. Creds come
 * from `POLYMARKET_API_KEY` / `_SECRET` / `_PASSPHRASE` (the operator's builder
 * profile — NOT per-user CLOB creds, and NOT the bytes32 builder *code*).
 */
import { buildL2HmacSignature } from "@caesar/chain/polymarket";
import { DEPOSIT_WALLET_FACTORY } from "@caesar/chain";

const DEFAULT_RELAYER = "https://relayer-v2.polymarket.com";

function relayerHost(): string {
  const h = process.env.POLYMARKET_RELAYER_URL || DEFAULT_RELAYER;
  return h.endsWith("/") ? h.slice(0, -1) : h;
}

export interface BuilderCreds {
  key: string;
  secret: string;
  passphrase: string;
}

/** Load the operator builder creds from env, or null if not fully configured. */
export function loadBuilderCreds(): BuilderCreds | null {
  const key = process.env.POLYMARKET_API_KEY;
  const secret = process.env.POLYMARKET_SECRET;
  const passphrase = process.env.POLYMARKET_PASSPHRASE;
  if (!key || !secret || !passphrase) return null;
  return { key, secret, passphrase };
}

/**
 * Builder HMAC headers for a relayer request. Signature is
 * HMAC-SHA256(base64 secret) over `timestamp+METHOD+path(+body)`, url-safe
 * base64 — same as `buildL2HmacSignature`, different header names.
 */
function builderHeaders(
  creds: BuilderCreds,
  method: string,
  path: string,
  body?: string,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = buildL2HmacSignature(creds.secret, ts, method, path, body);
  return {
    POLY_BUILDER_API_KEY: creds.key,
    POLY_BUILDER_PASSPHRASE: creds.passphrase,
    POLY_BUILDER_SIGNATURE: sig,
    POLY_BUILDER_TIMESTAMP: ts,
  };
}

export interface SubmitResult {
  transactionID: string;
  transactionHash: string;
  state: string;
}

/**
 * Request gasless creation of the deposit wallet owned by `ownerEoa` (the user's
 * Privy embedded EOA). Idempotent in effect: the address is deterministic, so a
 * repeat for an already-deployed owner is a no-op on-chain. Throws on auth /
 * transport failure.
 */
export async function createDepositWallet(ownerEoa: string, creds: BuilderCreds): Promise<SubmitResult> {
  const path = "/submit";
  const body = JSON.stringify({ type: "WALLET-CREATE", from: ownerEoa, to: DEPOSIT_WALLET_FACTORY });
  const res = await fetch(`${relayerHost()}${path}`, {
    method: "POST",
    headers: { ...builderHeaders(creds, "POST", path, body), "content-type": "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`relayer ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as SubmitResult;
}

/** Wire form of a deposit-wallet Batch call (value as decimal string). */
export interface DepositWalletCallWire {
  target: string;
  value: string;
  data: string;
}

/** Current Batch nonce for an owner's deposit wallet (relayer-tracked). */
export async function getDepositWalletNonce(ownerEoa: string): Promise<string> {
  const res = await fetch(`${relayerHost()}/nonce?address=${ownerEoa}&type=WALLET`);
  if (!res.ok) throw new Error(`relayer /nonce failed (HTTP ${res.status})`);
  const json = (await res.json()) as { nonce?: string };
  if (json.nonce == null) throw new Error("relayer /nonce returned no nonce");
  return json.nonce;
}

/**
 * Submit a gasless deposit-wallet Batch (e.g. approvals) via the relayer. The
 * owner EOA must have signed the EIP-712 `Batch` over {wallet, nonce, deadline,
 * calls} (see @caesar/chain `buildDepositWalletBatchTypedData`); `nonce` MUST be
 * the value the signature used (from `getDepositWalletNonce`).
 */
export async function executeDepositWalletBatch(
  params: {
    ownerEoa: string;
    depositWallet: string;
    nonce: string;
    deadline: string;
    calls: DepositWalletCallWire[];
    signature: string;
  },
  creds: BuilderCreds,
): Promise<SubmitResult> {
  const path = "/submit";
  const body = JSON.stringify({
    type: "WALLET",
    from: params.ownerEoa,
    to: DEPOSIT_WALLET_FACTORY,
    nonce: params.nonce,
    signature: params.signature,
    depositWalletParams: {
      depositWallet: params.depositWallet,
      deadline: params.deadline,
      calls: params.calls,
    },
  });
  const res = await fetch(`${relayerHost()}${path}`, {
    method: "POST",
    headers: { ...builderHeaders(creds, "POST", path, body), "content-type": "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`relayer ${path} (WALLET batch) failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text) as SubmitResult;
}

/** Whether a deposit wallet is deployed on-chain (keyless GET). */
export async function isDepositWalletDeployed(address: string): Promise<boolean> {
  const res = await fetch(`${relayerHost()}/deployed?address=${address}&type=WALLET`);
  if (!res.ok) return false;
  const json = (await res.json()) as { deployed?: boolean };
  return json.deployed === true;
}

/** Poll until the deposit wallet is deployed (or the attempt budget runs out). */
export async function waitForDepositWallet(
  address: string,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 3000;
  for (let i = 0; i < attempts; i++) {
    if (await isDepositWalletDeployed(address)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
