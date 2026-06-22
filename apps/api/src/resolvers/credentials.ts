/**
 * derivePolymarketApiCredentials — turn an in-browser L1 ClobAuth signature into
 * the user's CLOB API creds and persist them encrypted.
 *
 * SAFETY: this makes a live authenticated call to Polymarket, so it is gated
 * behind the same `CAESAR_ENABLE_MAINNET_TRADING` flag as order submission.
 * Deriving creds moves no funds, but we keep all live CLOB traffic behind one
 * switch. The browser signs the ClobAuth EIP-712 (buildClobAuthTypedData); we
 * forward {signature, timestamp, nonce} as L1 headers, never holding a key.
 */
import { type GraphQLContext } from "../auth.js";
import { resolveTradingWallet } from "../wallet.js";
import { deriveApiCredentials } from "../clob.js";
import { storeCredentials } from "../credentials.js";
import { hasEncryptionKey } from "../secrets.js";

const MAINNET_TRADING_ENABLED = process.env.CAESAR_ENABLE_MAINNET_TRADING === "true";

export interface DeriveCredentialsInput {
  /** ClobAuth EIP-712 signature (hex) from the embedded wallet. */
  signature: string;
  /** Unix seconds string — the exact `timestamp` the browser signed. */
  timestamp: string;
  /** Nonce string — the exact `nonce` the browser signed (default "0"). */
  nonce: string;
}

export interface DeriveCredentialsResult {
  success: boolean;
  error: string | null;
}

export async function resolveDerivePolymarketApiCredentials(
  ctx: GraphQLContext,
  input: DeriveCredentialsInput,
): Promise<DeriveCredentialsResult | null> {
  if (!ctx.auth) return null;

  if (!MAINNET_TRADING_ENABLED) {
    return {
      success: false,
      error:
        "mainnet trading disabled (set CAESAR_ENABLE_MAINNET_TRADING=true) — CLOB credential derivation is a live call",
    };
  }
  if (!hasEncryptionKey()) {
    return { success: false, error: "server misconfigured: CAESAR_CREDS_ENC_KEY not set" };
  }

  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) {
    return { success: false, error: "no trading wallet — sign in and provision an embedded wallet first" };
  }

  try {
    const creds = await deriveApiCredentials({
      signerAddress: wallet.signer,
      signature: input.signature,
      timestamp: input.timestamp,
      nonce: input.nonce,
    });
    await storeCredentials(ctx.auth.userId, wallet.signer, creds);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
