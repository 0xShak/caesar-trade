import { useQuery } from "@apollo/client";
import { Link, useParams } from "react-router-dom";
import {
  GET_MARKET,
  type GetMarketResult,
  type GetMarketVars,
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
      </div>
    </div>
  );
}
