import { useState } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatEther, type Address, type Hex, type TypedDataDefinition } from "viem";
import {
  POLYGON_CHAIN_ID,
  COLLATERAL_PUSD_V2,
  buildClobAuthTypedData,
  buildErc20TransferCall,
  buildDepositWalletApprovalCalls,
  buildDepositWalletBatchTypedData,
  assembleSafeTx,
  buildSafeTxTypedData,
  encodeExecTransaction,
} from "@caesar/chain";
import {
  POLYMARKET_ACCOUNT_STATE,
  DEPOSIT_WALLET_NONCE,
  CREATE_DEPOSIT_WALLET,
  SUBMIT_DEPOSIT_WALLET_APPROVALS,
  DERIVE_POLYMARKET_CREDENTIALS,
} from "@/gql/wallet";
import { useTradingWallet } from "@/lib/tradingWallet";
import { errMsg } from "@/lib/orders";

/** Client-side mainnet gate — mirrors the server CAESAR_ENABLE_MAINNET_TRADING.
 *  Live setup/trading buttons only render when this is explicitly "true". */
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
  safeNonce: string | null;
  depositWalletAddress: string | null;
  depositWalletDeployed: boolean;
  depositHasApprovals: boolean;
  depositPUsdBalance: number | null;
}

type Busy = null | "deposit" | "migrate" | "approve" | "creds";

/**
 * Portfolio / wallet-setup page for the CLOB V2 **deposit-wallet** (signatureType
 * 3) flow. Reads live on-chain readiness (`polymarketAccountState`) and, when the
 * mainnet gate is on, drives the browser-signed setup:
 *   1. create the deposit wallet (gasless, relayer-driven)
 *   2. migrate pUSD from the legacy Safe → deposit wallet (Safe execTransaction)
 *   3. set deposit-wallet approvals (gasless EIP-712 Batch via relayer)
 *   4. derive CLOB API creds (EOA L1 ClobAuth)
 * All signing happens in the Privy embedded wallet; the server holds no key.
 */
export function PortfolioPage() {
  const { ready, authenticated } = usePrivy();
  const wallet = useTradingWallet();
  const apollo = useApolloClient();
  const { data, loading, refetch } = useQuery<{ polymarketAccountState: AccountState | null }>(
    POLYMARKET_ACCOUNT_STATE,
    { skip: !authenticated, pollInterval: 8000 },
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [createDeposit] = useMutation(CREATE_DEPOSIT_WALLET);
  const [submitApprovals] = useMutation(SUBMIT_DEPOSIT_WALLET_APPROVALS);
  const [deriveCreds] = useMutation(DERIVE_POLYMARKET_CREDENTIALS);

  const acct = data?.polymarketAccountState ?? null;
  const gasWei = acct?.signerMaticWei ? BigInt(acct.signerMaticWei) : 0n;
  const hasGas = gasWei > 0n;
  const safePUsd = acct?.pUsdBalance ?? 0;
  const depositPUsd = acct?.depositPUsdBalance ?? 0;
  const deposit = acct?.depositWalletAddress as Address | undefined;
  const needsMigration = (acct?.depositWalletDeployed ?? false) && safePUsd > 0;

  const steps: Array<{ key: string; label: string; done: boolean }> = [
    { key: "deposit", label: "Create deposit wallet (gasless)", done: !!acct?.depositWalletDeployed },
    { key: "migrate", label: "Move pUSD collateral into deposit wallet", done: depositPUsd > 0 },
    { key: "approve", label: "Set deposit-wallet V2 approvals (gasless)", done: !!acct?.depositHasApprovals },
    { key: "creds", label: "Derive CLOB API credentials", done: !!acct?.hasApiCredentials },
  ];
  const tradeReady =
    !!acct?.depositWalletDeployed && !!acct?.depositHasApprovals && !!acct?.hasApiCredentials;
  const complete = tradeReady && depositPUsd > 0;

  async function runCreateDeposit() {
    setBusy("deposit");
    try {
      const res = await createDeposit();
      const out = res.data?.createDepositWallet;
      if (!out?.success) throw new Error(out?.error ?? "deposit-wallet creation failed");
      await waitFor(() => refetch().then((r) => !!r.data?.polymarketAccountState?.depositWalletDeployed));
      toast.success("Deposit wallet ready.");
    } catch (err) {
      toast.error(`Create failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runMigrate() {
    if (!acct?.safeAddress || !deposit) return;
    const amount = BigInt(Math.floor(safePUsd * 1e6));
    if (amount <= 0n) {
      toast.error("No pUSD in the Safe to migrate.");
      return;
    }
    setBusy("migrate");
    try {
      // Safe execTransaction: pUSD.transfer(depositWallet, fullBalance). The EOA
      // pays gas; the Safe is owned by the EOA, nonce read from chain.
      const transferData = buildErc20TransferCall(COLLATERAL_PUSD_V2, deposit, amount).data;
      const tx = assembleSafeTx({
        to: COLLATERAL_PUSD_V2,
        value: 0n,
        data: transferData,
        operation: 0,
        nonce: BigInt(acct.safeNonce ?? "0"),
      });
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
      toast.success(`Migration submitted — ${hash.slice(0, 10)}…`);
      await waitFor(() => refetch().then((r) => (r.data?.polymarketAccountState?.depositPUsdBalance ?? 0) > 0));
      toast.success("pUSD moved to deposit wallet.");
    } catch (err) {
      toast.error(`Migration failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runApprove() {
    if (!deposit) return;
    setBusy("approve");
    try {
      // Fetch the current Batch nonce, sign the four V2 approvals as an EIP-712
      // Batch; the server submits it gaslessly via the relayer.
      const nres = await apollo.query<{ depositWalletNonce: string | null }>({
        query: DEPOSIT_WALLET_NONCE,
        fetchPolicy: "network-only",
      });
      const nonce = nres.data?.depositWalletNonce ?? "0";
      const deadline = (Math.floor(Date.now() / 1000) + 3600).toString();
      const calls = buildDepositWalletApprovalCalls(POLYGON_CHAIN_ID);
      const td = buildDepositWalletBatchTypedData({
        walletAddress: deposit,
        chainId: POLYGON_CHAIN_ID,
        nonce: BigInt(nonce),
        deadline: BigInt(deadline),
        calls,
      }) as unknown as TypedDataDefinition;
      const signature = await wallet.signTypedData(td);
      const res = await submitApprovals({ variables: { input: { signature, nonce, deadline } } });
      const out = res.data?.submitDepositWalletApprovals;
      if (!out?.success) throw new Error(out?.error ?? "approval submission failed");
      await waitFor(() => refetch().then((r) => !!r.data?.polymarketAccountState?.depositHasApprovals));
      toast.success("Deposit-wallet approvals set.");
    } catch (err) {
      toast.error(`Approvals failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runDeriveCreds() {
    if (!acct?.signerAddress) return;
    setBusy("creds");
    try {
      // ClobAuth (L1): the EOA attests control. The api key binds to the EOA; the
      // deposit wallet is associated server-side via relayer registration.
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = "0";
      const td = buildClobAuthTypedData(
        acct.signerAddress as Address,
        POLYGON_CHAIN_ID,
        timestamp,
        BigInt(nonce),
      ) as unknown as TypedDataDefinition;
      const signature = await wallet.signTypedData(td);
      const res = await deriveCreds({ variables: { input: { signature, timestamp, nonce } } });
      const out = res.data?.derivePolymarketApiCredentials;
      if (!out?.success) throw new Error(out?.error ?? "credential derivation failed");
      await waitFor(() => refetch().then((r) => !!r.data?.polymarketAccountState?.hasApiCredentials));
      toast.success("CLOB credentials derived.");
    } catch (err) {
      toast.error(`Credentials failed: ${errMsg(err)}`);
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
              <span className="pill">deposit wallet</span>
              <span title={acct?.depositWalletAddress ?? undefined}>
                {acct?.depositWalletAddress ?? "—"}
              </span>
            </div>
            <div className="spike-row">
              <span className="pill">signer (EOA)</span>
              <span title={acct?.signerAddress ?? undefined}>
                {acct?.signerAddress ?? "—"} · {formatEther(gasWei)} MATIC
              </span>
            </div>
            <div className="spike-row">
              <span className="pill">collateral</span>
              <span>
                {fmtUsd(depositPUsd)} in deposit · {fmtUsd(safePUsd)} in legacy Safe
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
                {!acct?.depositWalletDeployed && (
                  <button className="btn" disabled={busy !== null} onClick={runCreateDeposit}>
                    {busy === "deposit" ? <Loader2 size={14} className="spin" /> : null} Create deposit
                    wallet
                  </button>
                )}
                {needsMigration && !hasGas && (
                  <p className="page-meta">
                    Send ~0.1 MATIC to your signer ({acct?.signerAddress}) to pay gas for the one-time
                    pUSD migration, then this updates automatically.
                  </p>
                )}
                {needsMigration && hasGas && (
                  <button className="btn" disabled={busy !== null} onClick={runMigrate}>
                    {busy === "migrate" ? <Loader2 size={14} className="spin" /> : null} Move{" "}
                    {fmtUsd(safePUsd)} pUSD → deposit wallet
                  </button>
                )}
                {acct?.depositWalletDeployed && !acct?.depositHasApprovals && (
                  <button className="btn" disabled={busy !== null} onClick={runApprove}>
                    {busy === "approve" ? <Loader2 size={14} className="spin" /> : null} Set V2 approvals
                  </button>
                )}
                {acct?.depositWalletDeployed && acct?.depositHasApprovals && !acct?.hasApiCredentials && (
                  <button className="btn" disabled={busy !== null} onClick={runDeriveCreds}>
                    {busy === "creds" ? <Loader2 size={14} className="spin" /> : null} Derive CLOB
                    credentials
                  </button>
                )}
              </div>
            ) : (
              <p className="page-meta" style={{ marginTop: 8 }}>
                On-chain setup actions are disabled (set <code>VITE_ENABLE_MAINNET_TRADING=true</code>{" "}
                to enable). Status above is read live from Polygon.
              </p>
            )}

            <div className="spike-row" style={{ marginTop: 8 }}>
              <span className="pill">status</span>
              <span>{complete ? "ready to trade" : tradeReady ? "ready (fund deposit wallet to trade)" : "incomplete"}</span>
            </div>

            {tradeReady && (
              <p className="page-meta" style={{ marginTop: 8 }}>
                Wallet ready — place orders from any market page.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function fmtUsd(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

/** Poll `check` until it resolves true (or give up after ~60s). */
async function waitFor(check: () => Promise<boolean>, tries = 20, delayMs = 3000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
