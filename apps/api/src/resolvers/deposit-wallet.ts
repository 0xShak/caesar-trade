/**
 * Deposit-wallet lifecycle mutations (CLOB V2 / signatureType 3).
 *
 * - `createDepositWallet`: relayer-driven, gasless creation of the user's deposit
 *   wallet (deterministic from their Privy EOA). The relayer also performs the
 *   server-side registration that a self-deploy would skip.
 * - `submitDepositWalletApprovals`: the user signs an EIP-712 `Batch` of the four
 *   V2 approvals in-browser; we submit it gaslessly via the relayer `factory.proxy`.
 *   The approval CALLS are built server-side (trusted) — the browser only signs.
 *
 * Both are live relayer writes, so they sit behind the same
 * `CAESAR_ENABLE_MAINNET_TRADING` gate as the rest of the live CLOB traffic.
 */
import { buildDepositWalletApprovalCalls, depositWalletCallsToWire, POLYGON_CHAIN_ID } from "@caesar/chain";
import { type GraphQLContext } from "../auth.js";
import { resolveTradingWallet } from "../wallet.js";
import {
  createDepositWallet,
  executeDepositWalletBatch,
  getDepositWalletNonce,
  isDepositWalletDeployed,
  loadBuilderCreds,
  waitForDepositWallet,
} from "../relayer.js";

const MAINNET_TRADING_ENABLED = process.env.CAESAR_ENABLE_MAINNET_TRADING === "true";
const GATED = "mainnet trading disabled (set CAESAR_ENABLE_MAINNET_TRADING=true) — relayer writes are live";

export interface CreateDepositWalletResult {
  success: boolean;
  address: string | null;
  deployed: boolean;
  transactionHash: string | null;
  error: string | null;
}

export async function resolveCreateDepositWallet(
  ctx: GraphQLContext,
): Promise<CreateDepositWalletResult | null> {
  if (!ctx.auth) return null;
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) {
    return { success: false, address: null, deployed: false, transactionHash: null, error: "no trading wallet — sign in first" };
  }
  const base = { address: wallet.depositWallet, deployed: false, transactionHash: null as string | null };

  // Already deployed? Idempotent — report success without another submit.
  if (await isDepositWalletDeployed(wallet.depositWallet)) {
    return { success: true, ...base, deployed: true, error: null };
  }
  if (!MAINNET_TRADING_ENABLED) {
    return { success: false, ...base, error: GATED };
  }
  const creds = loadBuilderCreds();
  if (!creds) {
    return { success: false, ...base, error: "server missing builder creds (POLYMARKET_API_KEY/_SECRET/_PASSPHRASE)" };
  }
  try {
    const res = await createDepositWallet(wallet.signer, creds);
    const deployed = await waitForDepositWallet(wallet.depositWallet, { attempts: 20, intervalMs: 3000 });
    return { success: deployed, address: wallet.depositWallet, deployed, transactionHash: res.transactionHash, error: deployed ? null : "submitted but not yet confirmed — retry shortly" };
  } catch (err) {
    return { success: false, ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SubmitDepositWalletApprovalsInput {
  /** EIP-712 Batch signature (hex) from the embedded EOA. */
  signature: string;
  /** The Batch nonce the signature used (from depositWalletNonce). */
  nonce: string;
  /** The Batch deadline (unix seconds string) the signature used. */
  deadline: string;
}

export interface SubmitDepositWalletApprovalsResult {
  success: boolean;
  transactionHash: string | null;
  error: string | null;
}

export async function resolveSubmitDepositWalletApprovals(
  ctx: GraphQLContext,
  input: SubmitDepositWalletApprovalsInput,
): Promise<SubmitDepositWalletApprovalsResult | null> {
  if (!ctx.auth) return null;
  if (!MAINNET_TRADING_ENABLED) return { success: false, transactionHash: null, error: GATED };
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return { success: false, transactionHash: null, error: "no trading wallet — sign in first" };
  const creds = loadBuilderCreds();
  if (!creds) return { success: false, transactionHash: null, error: "server missing builder creds" };

  // Rebuild the exact approval calls the browser signed over (trusted server-side).
  const calls = buildDepositWalletApprovalCalls(POLYGON_CHAIN_ID);
  try {
    const res = await executeDepositWalletBatch(
      {
        ownerEoa: wallet.signer,
        depositWallet: wallet.depositWallet,
        nonce: input.nonce,
        deadline: input.deadline,
        calls: depositWalletCallsToWire(calls),
        signature: input.signature,
      },
      creds,
    );
    return { success: true, transactionHash: res.transactionHash, error: null };
  } catch (err) {
    return { success: false, transactionHash: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Current Batch nonce for the user's deposit wallet (for the browser to sign with). */
export async function resolveDepositWalletNonce(ctx: GraphQLContext): Promise<string | null> {
  if (!ctx.auth) return null;
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return null;
  try {
    return await getDepositWalletNonce(wallet.signer);
  } catch {
    return null;
  }
}
