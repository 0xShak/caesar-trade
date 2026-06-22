import { useState } from "react";
import { useQuery } from "@apollo/client";
import { Link, useNavigate } from "react-router-dom";
import {
  GET_TRADERS,
  type GetTradersResult,
  type GetTradersVars,
} from "@/gql/traders";
import { fmtAmount, platformClass, truncId } from "@/lib/money";

const PAGE_SIZE = 25;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function TradersPage() {
  const navigate = useNavigate();
  const [addr, setAddr] = useState("");

  const { data, loading, error } = useQuery<GetTradersResult, GetTradersVars>(
    GET_TRADERS,
    { variables: { limit: PAGE_SIZE, offset: 0 } },
  );

  const conn = data?.traders;
  const traders = conn?.data ?? [];
  const total = conn?.total ?? 0;

  function submitAddress(e: React.FormEvent) {
    e.preventDefault();
    const v = addr.trim();
    if (ADDRESS_RE.test(v)) navigate(`/traders/${v}`);
  }

  const validAddr = ADDRESS_RE.test(addr.trim());

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Traders — active by recent volume</span>
        <span className="page-meta">
          {conn
            ? `${traders.length} shown · ${total} active`
            : loading
              ? "loading…"
              : ""}
        </span>
      </div>

      <form className="ctrl-bar" onSubmit={submitAddress}>
        <input
          className="ctrl-input"
          type="search"
          placeholder="Look up trader by proxy-wallet address (0x…)"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          style={{ minWidth: 360 }}
        />
        <button type="submit" className="btn" disabled={!validAddr}>
          Look up →
        </button>
      </form>

      {loading && !data ? (
        <div className="state-msg">Loading traders…</div>
      ) : error ? (
        <div className="state-msg state-err">GraphQL error: {error.message}</div>
      ) : traders.length === 0 ? (
        <div className="state-msg">No active traders in the recent feed.</div>
      ) : (
        <table className="mono-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Trader</th>
              <th>Platform</th>
              <th>Wallet</th>
              <th className="num">Recent Volume</th>
            </tr>
          </thead>
          <tbody>
            {traders.map((t) => (
              <tr
                key={t.id}
                className="row-link"
                onClick={() => navigate(`/traders/${t.id}`)}
              >
                <td className="num">{t.analytics?.rank ?? "—"}</td>
                <td>
                  <Link
                    to={`/traders/${t.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.displayName ?? truncId(t.id)}
                  </Link>
                </td>
                <td>
                  <span className={platformClass(t.platform)}>
                    {t.platform ?? "—"}
                  </span>
                </td>
                <td title={t.id}>{truncId(t.id)}</td>
                <td className="num">
                  {fmtAmount(t.analytics?.allTimeVolume, { compact: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
