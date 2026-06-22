import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { usePrivy } from "@privy-io/react-auth";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { type Address } from "viem";
import { roundPriceToTick } from "@caesar/chain";
import type { MarketDetail, DetailOutcome, DetailPlatformMarket } from "@/gql/markets";
import { POLYMARKET_ACCOUNT_STATE, PREPARE_POLYMARKET_ORDER, PREPARE_POLYMARKET_CANCEL } from "@/gql/wallet";
import { useTradingWallet } from "@/lib/tradingWallet";
import {
  buildSignedType3Order,
  sendPreparedToClob,
  coerceTickSize,
  errMsg,
} from "@/lib/orders";

/** Client-side mainnet gate — mirrors the server CAESAR_ENABLE_MAINNET_TRADING. */
const MAINNET = import.meta.env.VITE_ENABLE_MAINNET_TRADING === "true";

interface AccountState {
  hasApiCredentials: boolean;
  depositWalletAddress: string | null;
  depositWalletDeployed: boolean;
  depositHasApprovals: boolean;
  depositPUsdBalance: number | null;
}

/** The Polymarket platform-market for this market (trading is Polymarket-only). */
function polymarketMarket(market: MarketDetail): DetailPlatformMarket | null {
  return (market.platformMarkets ?? []).find((pm) => pm.platform === "polymarket") ?? null;
}

/** Outcomes that carry a CLOB token id (= externalOutcomeId) and are unresolved. */
function tradeableOutcomes(market: MarketDetail): DetailOutcome[] {
  return (market.outcomes ?? []).filter((o) => !!o.externalOutcomeId && !o.result);
}

/**
 * Production order ticket on the market-detail page. Sources the CLOB token id
 * (`externalOutcomeId`), neg-risk flag and tick size straight from the market
 * data — no pasted ids. Builds + browser-signs a type-3 (deposit-wallet /
 * ERC-1271) order via the proven path in `@/lib/orders`, then POSTs the
 * server-prepared request from the browser.
 *
 * Renders only for Polymarket markets with a tradeable outcome. Gates on Privy
 * auth, the deposit-wallet setup (`polymarketAccountState`) and the client
 * mainnet flag — pointing the user to wallet setup when incomplete.
 */
export function MarketOrderTicket({ market }: { market: MarketDetail }) {
  const pm = polymarketMarket(market);
  const outcomes = useMemo(() => tradeableOutcomes(market), [market]);

  const { ready, authenticated } = usePrivy();
  const wallet = useTradingWallet();
  const { data: acctData, loading: acctLoading } = useQuery<{ polymarketAccountState: AccountState | null }>(
    POLYMARKET_ACCOUNT_STATE,
    { skip: !authenticated || !pm, pollInterval: 15000 },
  );

  const [prepareOrder] = useMutation(PREPARE_POLYMARKET_ORDER);
  const [prepareCancel] = useMutation(PREPARE_POLYMARKET_CANCEL);

  const tickSize = coerceTickSize(pm?.tickSize);
  const negRisk = pm?.negRisk ?? false;
  const minOrderSize = pm?.minimumOrderSize ?? 0;

  const [tokenId, setTokenId] = useState<string>(outcomes[0]?.externalOutcomeId ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState<string>("");
  const [size, setSize] = useState<string>("");
  const [orderType, setOrderType] = useState<"GTC" | "FOK">("GTC");
  const [busy, setBusy] = useState<null | "submit" | "cancel">(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);

  const selected = outcomes.find((o) => o.externalOutcomeId === tokenId) ?? outcomes[0] ?? null;

  // Keep a valid selection and prefill the price from the chosen outcome's mid
  // whenever the outcome changes (or the market's outcomes load in).
  useEffect(() => {
    if (!selected?.externalOutcomeId) return;
    if (selected.externalOutcomeId !== tokenId) {
      setTokenId(selected.externalOutcomeId);
      return;
    }
    if (price === "" && selected.midPoint != null && Number.isFinite(selected.midPoint)) {
      setPrice(roundPriceToTick(selected.midPoint, tickSize).toString());
    }
  }, [selected, tokenId, price, tickSize]);

  // No trading UI for non-Polymarket markets or ones with no tradeable token.
  if (!pm || outcomes.length === 0) return null;

  const acct = acctData?.polymarketAccountState ?? null;
  const tradeReady =
    !!acct?.depositWalletDeployed && !!acct?.depositHasApprovals && !!acct?.hasApiCredentials;
  const depositWallet = acct?.depositWalletAddress as Address | undefined;
  const collateral = acct?.depositPUsdBalance ?? 0;

  const priceNum = Number(price);
  const sizeNum = Number(size);
  const notional = (priceNum || 0) * (sizeNum || 0);
  const priceValid = Number.isFinite(priceNum) && priceNum > 0 && priceNum < 1;
  const sizeValid = Number.isFinite(sizeNum) && sizeNum > 0 && (!minOrderSize || sizeNum >= minOrderSize);
  const canSubmit = MAINNET && tradeReady && !!depositWallet && priceValid && sizeValid && busy === null;

  async function onSubmit() {
    if (!depositWallet || !selected?.externalOutcomeId) return;
    if (!priceValid) {
      toast.error("Price must be between 0 and 1.");
      return;
    }
    if (!sizeValid) {
      toast.error(minOrderSize ? `Minimum order size is ${minOrderSize} shares.` : "Enter a size.");
      return;
    }
    setBusy("submit");
    try {
      const input = await buildSignedType3Order({
        depositWallet,
        sign: wallet.signTypedData,
        tokenId: selected.externalOutcomeId,
        side,
        price: roundPriceToTick(priceNum, tickSize),
        size: sizeNum,
        orderType,
        negRisk,
        tickSize,
      });
      const res = await prepareOrder({ variables: { input } });
      const { id, status } = await sendPreparedToClob(res.data?.preparePolymarketOrder);
      setLastOrderId(id);
      toast.success(`Order ${status ?? "accepted"}${id ? ` — ${id.slice(0, 10)}…` : ""}`);
    } catch (err) {
      toast.error(`Order failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function onCancel() {
    if (!lastOrderId) return;
    setBusy("cancel");
    try {
      const res = await prepareCancel({ variables: { orderId: lastOrderId } });
      await sendPreparedToClob(res.data?.preparePolymarketCancel);
      toast.success("Order canceled.");
      setLastOrderId(null);
    } catch (err) {
      toast.error(`Cancel failed: ${errMsg(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="detail-section">
      <div className="detail-section-title">Trade</div>

      {!ready ? (
        <div className="state-msg">Initializing…</div>
      ) : !authenticated ? (
        <div className="state-msg">Log in to trade this market.</div>
      ) : acctLoading && !acct ? (
        <div className="state-msg">Checking your trading wallet…</div>
      ) : !tradeReady ? (
        <div className="state-msg">
          Finish your one-time trading-wallet setup to place orders.{" "}
          <Link to="/portfolio">Set up wallet →</Link>
        </div>
      ) : (
        <div className="order-ticket" style={{ display: "grid", gap: 8, maxWidth: 540 }}>
          <div className="spike-row">
            <span className="page-meta">
              browser-signed · type-3 · {fmtUsd(collateral)} collateral
            </span>
          </div>

          {/* Outcome selector — one button per tradeable outcome (YES/NO/…). */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {outcomes.map((o) => {
              const active = o.externalOutcomeId === selected?.externalOutcomeId;
              return (
                <button
                  key={o.externalOutcomeId}
                  className={active ? "btn btn-acc" : "btn"}
                  onClick={() => {
                    setTokenId(o.externalOutcomeId!);
                    setPrice(
                      o.midPoint != null && Number.isFinite(o.midPoint)
                        ? roundPriceToTick(o.midPoint, tickSize).toString()
                        : "",
                    );
                  }}
                >
                  {o.outcomeName ?? "—"}
                  {o.midPoint != null ? ` · ${(o.midPoint * 100).toFixed(1)}¢` : ""}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="page-meta">side</span>
              <select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="page-meta">price (0–1)</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                style={{ width: 90 }}
                inputMode="decimal"
              />
            </label>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="page-meta">size (shares)</span>
              <input
                value={size}
                onChange={(e) => setSize(e.target.value)}
                style={{ width: 90 }}
                inputMode="decimal"
                placeholder={minOrderSize ? `≥ ${minOrderSize}` : undefined}
              />
            </label>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="page-meta">type</span>
              <select value={orderType} onChange={(e) => setOrderType(e.target.value as "GTC" | "FOK")}>
                <option value="GTC">GTC (rest)</option>
                <option value="FOK">FOK (fill)</option>
              </select>
            </label>
          </div>

          <div className="spike-row">
            <span className="page-meta">
              ~{fmtUsd(notional)} {side === "BUY" ? "cost" : "proceeds"}
              {negRisk ? " · neg-risk" : ""} · tick {tickSize}
            </span>
          </div>

          {!MAINNET && (
            <p className="page-meta">
              Trading is disabled (set <code>VITE_ENABLE_MAINNET_TRADING=true</code> for a supervised
              run). The ticket below is read-only.
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-acc" disabled={!canSubmit} onClick={onSubmit}>
              {busy === "submit" ? <Loader2 size={14} className="spin" /> : null} {side} {selected?.outcomeName ?? ""}
            </button>
            {lastOrderId && (
              <button className="btn" disabled={busy !== null} onClick={onCancel}>
                {busy === "cancel" ? <Loader2 size={14} className="spin" /> : null} Cancel last
              </button>
            )}
          </div>
          {lastOrderId && <span className="page-meta">resting order: {lastOrderId}</span>}
        </div>
      )}
    </section>
  );
}

function fmtUsd(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}
