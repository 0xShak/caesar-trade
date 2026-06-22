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
  POLYMARKET_POSITIONS,
  POLYMARKET_OPEN_ORDERS,
  PREPARE_POLYMARKET_CANCEL,
} from "@/gql/wallet";
import { useTradingWallet } from "@/lib/tradingWallet";
import { errMsg, sendPreparedToClob } from "@/lib/orders";

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
              <>
                <p className="page-meta" style={{ marginTop: 8 }}>
                  Wallet ready — place orders from any market page.
                </p>
                <PositionsPanel />
                <OpenOrdersPanel />
              </>
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

/** 0..1 probability → cents string, e.g. 0.47 → "47.0¢". */
function fmtCents(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}¢`;
}

/** Signed dollar P&L with a sign, e.g. -$1.20 / +$3.40. */
function fmtPnl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v < 0 ? "-" : "+";
  return `${s}$${Math.abs(v).toFixed(2)}`;
}

interface PolyPosition {
  asset: string;
  conditionId: string | null;
  title: string | null;
  outcome: string | null;
  size: number | null;
  avgPrice: number | null;
  curPrice: number | null;
  initialValue: number | null;
  currentValue: number | null;
  cashPnl: number | null;
  percentPnl: number | null;
  redeemable: boolean | null;
}

/** Live positions held by the deposit wallet (read from the Polymarket data-api). */
function PositionsPanel() {
  const { data, loading } = useQuery<{ polymarketPositions: PolyPosition[] | null }>(
    POLYMARKET_POSITIONS,
    { pollInterval: 20000 },
  );
  const positions = data?.polymarketPositions ?? [];

  return (
    <section className="detail-section" style={{ marginTop: 16 }}>
      <div className="detail-section-title">Positions</div>
      {loading && !data ? (
        <div className="state-msg">Loading positions…</div>
      ) : positions.length === 0 ? (
        <div className="state-msg">No open positions.</div>
      ) : (
        <table className="mono-table">
          <thead>
            <tr>
              <th>Market</th>
              <th>Outcome</th>
              <th className="num">Size</th>
              <th className="num">Avg</th>
              <th className="num">Cur</th>
              <th className="num">Value</th>
              <th className="num">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.asset}>
                <td title={p.title ?? undefined}>{p.title ?? truncMid(p.conditionId)}</td>
                <td>{p.outcome ?? "—"}</td>
                <td className="num">{p.size != null ? p.size.toLocaleString() : "—"}</td>
                <td className="num">{fmtCents(p.avgPrice)}</td>
                <td className="num">{fmtCents(p.curPrice)}</td>
                <td className="num">{fmtUsd(p.currentValue)}</td>
                <td className={`num ${pnlClass(p.cashPnl)}`}>{fmtPnl(p.cashPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface PolyOpenOrder {
  id: string;
  status: string | null;
  conditionId: string | null;
  assetId: string | null;
  outcome: string | null;
  side: string | null;
  price: number | null;
  originalSize: number | null;
  sizeMatched: number | null;
  sizeRemaining: number | null;
  orderType: string | null;
  createdAt: string | null;
}

/** The user's resting CLOB orders, with a per-row cancel (browser-submitted). */
function OpenOrdersPanel() {
  const { data, loading, refetch } = useQuery<{ polymarketOpenOrders: PolyOpenOrder[] | null }>(
    POLYMARKET_OPEN_ORDERS,
    { pollInterval: 15000 },
  );
  const [prepareCancel] = useMutation(PREPARE_POLYMARKET_CANCEL);
  const [canceling, setCanceling] = useState<string | null>(null);
  const orders = data?.polymarketOpenOrders ?? [];

  async function cancel(id: string) {
    setCanceling(id);
    try {
      const res = await prepareCancel({ variables: { orderId: id } });
      await sendPreparedToClob(res.data?.preparePolymarketCancel);
      toast.success("Order canceled.");
      await refetch();
    } catch (err) {
      toast.error(`Cancel failed: ${errMsg(err)}`);
    } finally {
      setCanceling(null);
    }
  }

  return (
    <section className="detail-section" style={{ marginTop: 16 }}>
      <div className="detail-section-title">Open orders</div>
      {loading && !data ? (
        <div className="state-msg">Loading orders…</div>
      ) : orders.length === 0 ? (
        <div className="state-msg">No resting orders.</div>
      ) : (
        <table className="mono-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Outcome</th>
              <th className="num">Price</th>
              <th className="num">Filled</th>
              <th className="num">Size</th>
              <th>Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <span className={o.side === "SELL" ? "pill state-err" : "pill platform-kalshi"}>
                    {o.side ?? "—"}
                  </span>
                </td>
                <td title={o.assetId ?? undefined}>{o.outcome ?? "—"}</td>
                <td className="num">{fmtCents(o.price)}</td>
                <td className="num">
                  {o.sizeMatched != null && o.originalSize != null
                    ? `${o.sizeMatched}/${o.originalSize}`
                    : "—"}
                </td>
                <td className="num">
                  {o.sizeRemaining != null ? o.sizeRemaining.toLocaleString() : "—"}
                </td>
                <td>{o.orderType ?? "—"}</td>
                <td className="num">
                  <button
                    className="btn"
                    disabled={canceling !== null}
                    onClick={() => cancel(o.id)}
                  >
                    {canceling === o.id ? <Loader2 size={14} className="spin" /> : null} Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function pnlClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return v > 0 ? "pnl-pos" : "pnl-neg";
}

/** Short middle-truncated id, e.g. 0x1234…cdef. */
function truncMid(id: string | null): string {
  if (!id) return "—";
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Poll `check` until it resolves true (or give up after ~60s). */
async function waitFor(check: () => Promise<boolean>, tries = 20, delayMs = 3000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
