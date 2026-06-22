import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useSubscription } from "@apollo/client";
import { Link, useParams } from "react-router-dom";
import {
  GET_MARKET,
  GET_MARKET_TRADES,
  GET_MARKET_POSITIONS,
  MARKET_TRADES_SUB,
  type GetMarketResult,
  type GetMarketVars,
  type GetMarketTradesResult,
  type GetMarketTradesVars,
  type GetMarketPositionsResult,
  type GetMarketPositionsVars,
  type MarketTradesSubResult,
  type MarketTradesSubVars,
  type RecentTrade,
  type SubTrade,
  type DetailOutcome,
} from "@/gql/markets";
import {
  fmtAmount,
  fmtProbCents,
  fmtProbPct,
  fmtDate,
  platformClass,
  truncId,
} from "@/lib/money";
import { formatDollars } from "@caesar/money";
import { PriceChart } from "@/components/PriceChart";
import { OrderBook } from "@/components/OrderBook";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function outcomeResultClass(result: string | null): string {
  if (result === "YES") return "pill platform-kalshi";
  if (result === "NO") return "pill state-err";
  return "pill";
}

function sideClass(side: string | null): string {
  if (side === "BUY") return "pill platform-kalshi";
  if (side === "SELL") return "pill state-err";
  return "pill";
}

/** Trade datetime ISO → HH:MM:SS, locale-stable. */
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour12: false });
}

/** 0..1 probability → cents string, e.g. 0.47 → "47.0¢". */
function tradePriceCents(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return "—";
  return `${(price * 100).toFixed(1)}¢`;
}

/** Integer microdollar value → "$X.XX". */
function fmtMicroValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatDollars(BigInt(Math.round(value)));
}

/** Max rows kept in the live tape. */
const TRADE_TAPE_CAP = 50;

/** Stable identity for a tape row (dedupe + React key). */
function tradeKey(t: RecentTrade): string {
  return (
    t.key ??
    t.transactionHash ??
    `${t.datetime ?? ""}:${t.outcomeName ?? ""}:${t.side ?? ""}:${t.size ?? ""}`
  );
}

/** Normalize a live SubTrade into the tape's RecentTrade shape. */
function subTradeToRow(s: SubTrade): RecentTrade {
  return {
    key: s.transactionHash,
    transactionHash: s.transactionHash,
    side: s.side,
    price: s.price,
    size: s.size,
    totalValue: s.totalValue,
    datetime: s.datetime,
    platform: null,
    outcomeName: s.outcomeName,
    trader: s.trader ? { id: null, displayName: s.trader.displayName } : null,
  };
}

function RecentTradesSection({ marketId }: { marketId: string }) {
  const { data, loading, error } = useQuery<
    GetMarketTradesResult,
    GetMarketTradesVars
  >(GET_MARKET_TRADES, { variables: { marketId, limit: TRADE_TAPE_CAP } });

  // Local tape: backfilled from the query, prepended by the live subscription.
  const [tape, setTape] = useState<RecentTrade[]>([]);
  // Keys that arrived via the live socket (for a brief row highlight).
  const [liveKeys, setLiveKeys] = useState<Set<string>>(() => new Set());
  const seenRef = useRef<Set<string>>(new Set());

  // Seed / re-seed the tape whenever the backfill query resolves.
  const backfill = useMemo(
    () => data?.marketRecentTrades ?? null,
    [data?.marketRecentTrades],
  );
  useEffect(() => {
    if (!backfill) return;
    const rows = backfill.slice(0, TRADE_TAPE_CAP);
    seenRef.current = new Set(rows.map(tradeKey));
    setTape(rows);
  }, [backfill]);

  const { data: subData } = useSubscription<
    MarketTradesSubResult,
    MarketTradesSubVars
  >(MARKET_TRADES_SUB, {
    variables: { marketId },
    // WS down / server error must not blank the tape — log and keep the
    // query-backfilled rows.
    onError: (err) => {
      console.warn("[marketTrades] subscription error:", err.message);
    },
  });

  // Prepend each new live trade, deduped by key, capped at TRADE_TAPE_CAP.
  useEffect(() => {
    const incoming = subData?.marketTrades;
    if (!incoming) return;
    const row = subTradeToRow(incoming);
    const k = tradeKey(row);
    if (seenRef.current.has(k)) return;
    seenRef.current.add(k);
    setTape((prev) => [row, ...prev].slice(0, TRADE_TAPE_CAP));
    setLiveKeys((prev) => new Set(prev).add(k));
    // Drop the highlight after a beat.
    const timer = window.setTimeout(() => {
      setLiveKeys((prev) => {
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [subData]);

  // Live once the WS link has delivered at least one payload (or is mounted
  // without error); we show the pill whenever the subscription is wired up.
  const isLive = subData != null || tape.length > 0;

  return (
    <section className="detail-section">
      <div className="detail-section-title">
        Recent trades
        {isLive && (
          <span className="live-pill" title="Streaming live trades">
            ● live
          </span>
        )}
      </div>
      {loading && !data ? (
        <div className="state-msg">Loading trades…</div>
      ) : error ? (
        <div className="state-msg state-err">{error.message}</div>
      ) : tape.length === 0 ? (
        <div className="state-msg">No recent trades.</div>
      ) : (
        <table className="mono-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Side</th>
              <th>Outcome</th>
              <th className="num">Price</th>
              <th className="num">Size</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {tape.map((t, i) => {
              const k = tradeKey(t);
              return (
                <tr
                  key={`${k}:${i}`}
                  className={liveKeys.has(k) ? "trade-row-new" : undefined}
                >
                  <td>{fmtTime(t.datetime)}</td>
                  <td>
                    <span className={sideClass(t.side)}>{t.side ?? "—"}</span>
                  </td>
                  <td>{t.outcomeName ?? "—"}</td>
                  <td className="num">{tradePriceCents(t.price)}</td>
                  <td className="num">
                    {t.size != null ? t.size.toLocaleString() : "—"}
                  </td>
                  <td className="num">{fmtMicroValue(t.totalValue)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TopHoldersSection({ marketId }: { marketId: string }) {
  const { data, loading, error } = useQuery<
    GetMarketPositionsResult,
    GetMarketPositionsVars
  >(GET_MARKET_POSITIONS, { variables: { marketId } });

  const groups = data?.marketPositions ?? [];

  return (
    <section className="detail-section">
      <div className="detail-section-title">Top holders</div>
      {loading && !data ? (
        <div className="state-msg">Loading holders…</div>
      ) : error ? (
        <div className="state-msg state-err">{error.message}</div>
      ) : groups.length === 0 ? (
        <div className="state-msg">No holder data (Polymarket only).</div>
      ) : (
        groups.map((g) => {
          const positions = g.positions ?? [];
          return (
            <div key={g.outcomeId ?? g.outcome ?? String(g.outcomeIndex)}>
              <div className="detail-meta">
                <span className="pill">
                  {g.outcome ?? `Outcome ${g.outcomeIndex ?? "—"}`}
                </span>
                <span className="page-meta">{positions.length} holders</span>
              </div>
              {positions.length === 0 ? (
                <div className="state-msg">—</div>
              ) : (
                <table className="mono-table">
                  <thead>
                    <tr>
                      <th>Holder</th>
                      <th>Wallet</th>
                      <th className="num">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, i) => (
                      <tr key={p.proxyWallet ?? `${g.outcomeId}:${i}`}>
                        <td>
                          {p.proxyWallet ? (
                            <Link to={`/traders/${p.proxyWallet}`}>
                              {p.trader?.displayName ?? truncId(p.proxyWallet)}
                            </Link>
                          ) : (
                            (p.trader?.displayName ?? "—")
                          )}
                        </td>
                        <td title={p.proxyWallet ?? undefined}>
                          {p.proxyWallet ? (
                            <Link to={`/traders/${p.proxyWallet}`}>
                              {truncId(p.proxyWallet)}
                            </Link>
                          ) : (
                            truncId(p.proxyWallet)
                          )}
                        </td>
                        <td className="num">
                          {p.size != null ? p.size.toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

export function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useQuery<GetMarketResult, GetMarketVars>(
    GET_MARKET,
    { variables: { id: id ?? "" }, skip: !id },
  );

  const market = data?.market ?? null;

  const back = (
    <div className="page-header">
      <span className="page-title">
        <Link to="/markets">← Markets</Link>
      </span>
      <span className="page-meta">{id}</span>
    </div>
  );

  if (loading && !data) {
    return (
      <div>
        {back}
        <div className="state-msg">Loading market…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {back}
        <div className="state-msg state-err">GraphQL error: {error.message}</div>
      </div>
    );
  }
  if (!market) {
    return (
      <div>
        {back}
        <div className="state-msg">Market not found.</div>
      </div>
    );
  }

  const outcomes: DetailOutcome[] = market.outcomes ?? [];
  const platformMarkets = market.platformMarkets ?? [];

  return (
    <div>
      {back}

      <div className="page-body detail-body">
        <div className="detail-head">
          <h1 className="detail-question">
            {market.question ?? market.displayNameShort ?? market.id}
          </h1>
          <div className="detail-meta">
            <span className={platformClass(market.platform)}>
              {market.platform ?? "—"}
            </span>
            <span className="pill">{market.status ?? "—"}</span>
            <span className="page-meta">Ends {fmtDate(market.endDate)}</span>
            {market.slug && <span className="page-meta">{market.slug}</span>}
          </div>
          {market.description && (
            <p className="detail-desc">{market.description}</p>
          )}
        </div>

        <div className="stat-strip">
          <Stat label="Volume" value={fmtAmount(market.volume, { compact: true })} />
          <Stat
            label="Liquidity"
            value={fmtAmount(market.liquidity, { compact: true })}
          />
          <Stat
            label="Open Interest"
            value={fmtAmount(market.totalOpenInterest, { compact: true })}
          />
          <Stat
            label="24h Net Flow"
            value={fmtAmount(market.netFlowVolumes?.volume24hMicrodollars, {
              compact: true,
            })}
          />
        </div>

        <section className="detail-section">
          <PriceChart marketId={market.id} />
        </section>

        <section className="detail-section">
          <div className="detail-section-title">Outcomes</div>
          {outcomes.length === 0 ? (
            <div className="state-msg">No outcomes.</div>
          ) : (
            <table className="mono-table">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th className="num">Mid</th>
                  <th className="num">Prob</th>
                  <th className="num">Spread</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.outcomeId ?? o.externalOutcomeId ?? o.outcomeName}>
                    <td>
                      {o.outcomeName ?? "—"}
                      {o.isPrimary && <span className="pill primary-pill">primary</span>}
                    </td>
                    <td className="num">{fmtProbCents(o.midPoint)}</td>
                    <td className="num">{fmtProbPct(o.midPoint)}</td>
                    <td className="num">{fmtProbCents(o.spread)}</td>
                    <td>
                      {o.result ? (
                        <span className={outcomeResultClass(o.result)}>
                          {o.result}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <OrderBook marketId={market.id} />

        <section className="detail-section">
          <div className="detail-section-title">Platform markets</div>
          {platformMarkets.length === 0 ? (
            <div className="state-msg">No platform markets.</div>
          ) : (
            <table className="mono-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>External ID</th>
                  <th className="num">Tick</th>
                  <th className="num">Min Order</th>
                  <th className="num">Fee</th>
                  <th>Neg Risk</th>
                </tr>
              </thead>
              <tbody>
                {platformMarkets.map((pm) => (
                  <tr key={pm.id ?? pm.externalId}>
                    <td>
                      <span className={platformClass(pm.platform)}>
                        {pm.platform ?? "—"}
                      </span>
                    </td>
                    <td title={pm.externalId ?? undefined}>
                      {truncId(pm.externalId)}
                    </td>
                    <td className="num">{pm.tickSize ?? "—"}</td>
                    <td className="num">{pm.minimumOrderSize ?? "—"}</td>
                    <td className="num">
                      {pm.feeRate != null
                        ? `${(pm.feeRate * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td>{pm.negRisk == null ? "—" : pm.negRisk ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <RecentTradesSection marketId={market.id} />

        <TopHoldersSection marketId={market.id} />
      </div>
    </div>
  );
}
