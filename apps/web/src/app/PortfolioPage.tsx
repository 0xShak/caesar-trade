import { useState } from "react";
import { useQuery } from "@apollo/client";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatEther, type Address, type Hex, type TypedDataDefinition } from "viem";
import {
  INFRA,
  POLYGON_CHAIN_ID,
  buildCreateProxyTypedData,
  encodeCreateProxyCall,
  buildApprovalMultiSendTx,
  assembleSafeTx,
  buildSafeTxTypedData,
  encodeExecTransaction,
} from "@caesar/chain";
import { POLYMARKET_ACCOUNT_STATE } from "@/gql/wallet";
import { useTradingWallet } from "@/lib/tradingWallet";

/** Client-side mainnet gate — mirrors the server CAESAR_ENABLE_MAINNET_TRADING.
 *  Live deploy/approval buttons only render when this is explicitly "true". */
const MAINNET = import.meta.env.VITE_ENABLE_MAINNET_TRADING === "true";

interface AccountState {
  signerAddress: string | null;
  safeAddress: string | null;
  isDeployed: boolean;
  hasV2Approvals: boolean;
  hasApiCredentials: boolean;
  signerMaticWei: string | null;
  pUsdBalance: number | null;
  usdceBalance: number | null;
}

/**
 * Portfolio / wallet-setup page. Reads live on-chain readiness
 * (`polymarketAccountState`) and, when the mainnet gate is on, drives the
 * browser-signed setup steps: deploy the Safe (CreateProxy sig → factory) and set
 * V2 approvals (SafeTx sig → execTransaction). All signing happens in the user's
 * Privy embedded wallet; the server never holds a key. See docs/PHASE3-LIVE-TRADING.md.
 */
export function PortfolioPage() {
  const { ready, authenticated } = usePrivy();
  const wallet = useTradingWallet();
  const { data, loading, refetch } = useQuery<{ polymarketAccountState: AccountState | null }>(
    POLYMARKET_ACCOUNT_STATE,
    { skip: !authenticated, pollInterval: 8000 },
  );
  const [busy, setBusy] = useState<null | "deploy" | "approve">(null);

  const acct = data?.polymarketAccountState ?? null;
  const gasWei = acct?.signerMaticWei ? BigInt(acct.signerMaticWei) : 0n;
  const hasGas = gasWei > 0n;

  const steps: Array<{ key: string; label: string; done: boolean }> = [
    { key: "gas", label: "Fund signer with gas (MATIC)", done: hasGas },
    { key: "deploy", label: "Deploy trading Safe", done: !!acct?.isDeployed },
    { key: "approve", label: "Set V2 exchange approvals", done: !!acct?.hasV2Approvals },
    { key: "creds", label: "Derive CLOB API credentials", done: !!acct?.hasApiCredentials },
  ];
  const complete = steps.every((s) => s.done);

  async function runDeploy() {
    if (!acct?.signerAddress) return;
    setBusy("deploy");
    try {
      const td = buildCreateProxyTypedData(POLYGON_CHAIN_ID) as unknown as TypedDataDefinition;
      const sig = await wallet.signTypedData(td);
      const hash = await wallet.sendTx({
        to: INFRA.safeFactory as Address,
        data: encodeCreateProxyCall(sig as Hex),
      });
      toast.success(`Deploy submitted — ${hash.slice(0, 10)}…`);
      // Poll the account state until the Safe shows deployed.
      await waitFor(() => refetch().then((r) => !!r.data?.polymarketAccountState?.isDeployed));
      toast.success("Safe deployed.");
    } catch (err) {
      toast.error(`Deploy failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runApprove() {
    if (!acct?.safeAddress) return;
    setBusy("approve");
    try {
      // Fresh Safe → approvals are its first tx (nonce 0). Production should read
      // the live Safe nonce(); 0 is correct for the initial setup.
      const inner = buildApprovalMultiSendTx(POLYGON_CHAIN_ID, "v2");
      const tx = assembleSafeTx({ ...inner, nonce: 0n });
      const td = buildSafeTxTypedData(
        POLYGON_CHAIN_ID,
        acct.safeAddress as Address,
        tx,
      ) as unknown as TypedDataDefinition;
      const sig = await wallet.signTypedData(td);
      const hash = await wallet.sendTx({
        to: acct.safeAddress as Address,
        data: encodeExecTransaction(tx, sig as Hex),
      });
      toast.success(`Approvals submitted — ${hash.slice(0, 10)}…`);
      await waitFor(() => refetch().then((r) => !!r.data?.polymarketAccountState?.hasV2Approvals));
      toast.success("V2 approvals set.");
    } catch (err) {
      toast.error(`Approvals failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Portfolio</span>
        <span className="page-meta">wallet setup{MAINNET ? " · mainnet" : ""}</span>
      </div>
      <div className="page-body spike-wrap">
        {!ready ? (
          <div className="state-msg">Initializing…</div>
        ) : !authenticated ? (
          <div className="state-msg">Log in to view your trading-wallet setup.</div>
        ) : loading && !acct ? (
          <div className="state-msg">Loading on-chain state…</div>
        ) : (
          <>
            <div className="spike-row">
              <span className="pill">trading wallet</span>
              <span title={acct?.safeAddress ?? undefined}>{acct?.safeAddress ?? "—"}</span>
            </div>
            <div className="spike-row">
              <span className="pill">signer (EOA)</span>
              <span title={acct?.signerAddress ?? undefined}>
                {acct?.signerAddress ?? "—"} · {formatEther(gasWei)} MATIC
              </span>
            </div>
            <div className="spike-row">
              <span className="pill">balances</span>
              <span>
                {fmtUsd(acct?.pUsdBalance)} pUSD · {fmtUsd(acct?.usdceBalance)} USDC.e
              </span>
            </div>

            <ul className="setup-checklist">
              {steps.map((s) => (
                <li key={s.key} className={s.done ? "setup-step done" : "setup-step"}>
                  {s.done ? <Check size={14} /> : <Circle size={14} />}
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>

            {MAINNET ? (
              <div className="setup-actions">
                {!hasGas && acct?.signerAddress && (
                  <p className="page-meta">
                    Send ~1 MATIC to your signer ({acct.signerAddress}) to pay setup gas, then
                    this updates automatically.
                  </p>
                )}
                {hasGas && !acct?.isDeployed && (
                  <button className="btn" disabled={busy !== null} onClick={runDeploy}>
                    {busy === "deploy" ? <Loader2 size={14} className="spin" /> : null} Deploy Safe
                  </button>
                )}
                {acct?.isDeployed && !acct?.hasV2Approvals && (
                  <button className="btn" disabled={busy !== null} onClick={runApprove}>
                    {busy === "approve" ? <Loader2 size={14} className="spin" /> : null} Set V2
                    approvals
                  </button>
                )}
                {acct?.isDeployed && acct?.hasV2Approvals && !acct?.hasApiCredentials && (
                  <p className="page-meta">
                    Next: derive CLOB credentials (coming in the trading step).
                  </p>
                )}
              </div>
            ) : (
              <p className="page-meta" style={{ marginTop: 8 }}>
                On-chain setup actions are disabled (set <code>VITE_ENABLE_MAINNET_TRADING=true</code>{" "}
                to enable live deploy/approvals). Status above is read live from Polygon.
              </p>
            )}

            <div className="spike-row" style={{ marginTop: 8 }}>
              <span className="pill">status</span>
              <span>{complete ? "ready to trade" : "incomplete"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function fmtUsd(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

function errMsg(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 140 ? m.slice(0, 140) + "…" : m;
}

/** Poll `check` until it resolves true (or give up after ~60s). */
async function waitFor(check: () => Promise<boolean>, tries = 20, delayMs = 3000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
