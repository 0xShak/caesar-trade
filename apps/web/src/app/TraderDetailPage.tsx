import { useQuery } from "@apollo/client";
import { Link, useParams } from "react-router-dom";
import {
  GET_TRADER,
  GET_TRADER_POSITIONS,
  type GetTraderResult,
  type GetTraderVars,
  type GetTraderPositionsResult,
  type GetTraderPositionsVars,
} from "@/gql/traders";
import { fmtAmount, fmtProbCents, platformClass, truncId } from "@/lib/money";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

/** Microdollar PnL → signed "$X.XX" with a +/- sign for coloring intent. */
function fmtSignedAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const formatted = fmtAmount(Math.abs(value));
  return value < 0 ? `-${formatted}` : `+${formatted}`;
}

function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "num";
  return value > 0 ? "num pnl-pos" : "num pnl-neg";
}

function PositionsSection({ traderId }: { traderId: string }) {
  const { data, loading, error } = useQuery<
    GetTraderPositionsResult,
    GetTraderPositionsVars
  >(GET_TRADER_POSITIONS, { variables: { traderId } });

  const groups = data?.traderPositions?.data ?? [];

  return (
    <section className="detail-section">
      <div className="detail-section-title">Positions</div>
      {loading && !data ? (
        <div className="state-msg">Loading positions…</div>
      ) : error ? (
        <div className="state-msg state-err">{error.message}</div>
      ) : groups.length === 0 ? (
        <div className="state-msg">No open positions.</div>
      ) : (
        <table className="mono-table">
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Size</th>
              <th className="num">Avg</th>
              <th className="num">Cur</th>
              <th className="num">Value</th>
              <th className="num">PnL</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) =>
              (g.positions ?? []).map((p, i) => (
                <tr key={`${g.marketId ?? ""}:${i}`}>
                  <td
                    title={g.marketTitle ?? undefined}
                    style={{ maxWidth: 420 }}
                  >
                    {g.marketTitle ?? g.marketTicker ?? g.marketId ?? "—"}
                  </td>
                  <td className="num">
                    {p.size != null ? p.size.toLocaleString() : "—"}
                  </td>
                  <td className="num">{fmtProbCents(p.avgEntryPrice)}</td>
                  <td className="num">{fmtProbCents(p.currentPrice)}</td>
                  <td className="num">{fmtAmount(p.currentValue)}</td>
                  <td className={pnlClass(p.unrealizedPnl)}>
                    {fmtSignedAmount(p.unrealizedPnl)}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function TraderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useQuery<GetTraderResult, GetTraderVars>(
    GET_TRADER,
    { variables: { id: id ?? "" }, skip: !id },
  );

  const trader = data?.trader ?? null;

  const back = (
    <div className="page-header">
      <span className="page-title">
        <Link to="/traders">← Traders</Link>
      </span>
      <span className="page-meta">{id ? truncId(id) : ""}</span>
    </div>
  );

  if (loading && !data) {
    return (
      <div>
        {back}
        <div className="state-msg">Loading trader…</div>
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
  if (!trader) {
    return (
      <div>
        {back}
        <div className="state-msg">Trader not found.</div>
      </div>
    );
  }

  return (
    <div>
      {back}

      <div className="page-body detail-body">
        <div className="detail-head">
          <h1 className="detail-question">
            {trader.displayName ?? truncId(trader.id)}
          </h1>
          <div className="detail-meta">
            <span className={platformClass(trader.platform)}>
              {trader.platform ?? "—"}
            </span>
            <span className="pill" title={trader.id}>
              {truncId(trader.id)}
            </span>
            {trader.username && (
              <span className="page-meta">@{trader.username}</span>
            )}
          </div>
        </div>

        <div className="stat-strip">
          <Stat
            label="Portfolio Value"
            value={fmtAmount(trader.onchain?.usdcBalance)}
          />
          <Stat
            label="All-time PnL"
            value={fmtSignedAmount(trader.analytics?.allTimePnl)}
          />
          <Stat
            label="Volume"
            value={fmtAmount(trader.analytics?.allTimeVolume, { compact: true })}
          />
        </div>

        <PositionsSection traderId={trader.id} />
      </div>
    </div>
  );
}
