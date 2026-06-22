import { useEffect, useMemo, useState } from "react";
import { useQuery, useSubscription } from "@apollo/client";
import {
  GET_MARKET_ORDERBOOK,
  ORDERBOOK_UPDATES_SUB,
  type GetMarketOrderbookResult,
  type OrderbookUpdatesResult,
  type OrderbookVars,
  type Orderbook,
  type OrderbookLevel,
} from "@/gql/orderbook";

/** Levels shown per side. */
const DEPTH = 12;

/** micro-USD per share → cents string, e.g. 510000 → "51.0¢". */
function micToCents(mic: number | null): string {
  if (mic == null || !Number.isFinite(mic)) return "—";
  return `${(mic / 1e4).toFixed(1)}¢`;
}

/** Share count → compact string (1.2k / 340). */
function fmtSize(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ObRow({
  lvl,
  side,
  maxSize,
}: {
  lvl: OrderbookLevel;
  side: "bid" | "ask";
  maxSize: number;
}) {
  const pct = maxSize > 0 ? Math.max(2, (lvl.size / maxSize) * 100) : 0;
  return (
    <div className={`ob-row ob-${side}`}>
      <span className="ob-bar" style={{ width: `${pct}%` }} />
      <span className="ob-price num">{micToCents(lvl.priceMicrodollars)}</span>
      <span className="ob-size num">{fmtSize(lvl.size)}</span>
    </div>
  );
}

/**
 * Live CLOB orderbook depth (Polymarket-only). Seeds from the snapshot query,
 * then replaces the book on each `orderbookUpdates` payload over the WS link.
 * Classic ladder: asks above the mid (lowest ask nearest the spread), bids below.
 */
export function OrderBook({ marketId }: { marketId: string }) {
  const { data, loading, error } = useQuery<GetMarketOrderbookResult, OrderbookVars>(
    GET_MARKET_ORDERBOOK,
    { variables: { marketId } },
  );

  const [book, setBook] = useState<Orderbook | null>(null);

  // Seed / re-seed from the snapshot query.
  useEffect(() => {
    if (data?.marketOrderbook) setBook(data.marketOrderbook);
  }, [data?.marketOrderbook]);

  // Live updates — replace the book wholesale (server dedupes by hash).
  const { data: subData } = useSubscription<OrderbookUpdatesResult, OrderbookVars>(
    ORDERBOOK_UPDATES_SUB,
    {
      variables: { marketId },
      onError: (err) => {
        console.warn("[orderbookUpdates] subscription error:", err.message);
      },
    },
  );
  useEffect(() => {
    if (subData?.orderbookUpdates) setBook(subData.orderbookUpdates);
  }, [subData]);

  const asks = useMemo(() => (book?.asks ?? []).slice(0, DEPTH), [book]);
  const bids = useMemo(() => (book?.bids ?? []).slice(0, DEPTH), [book]);
  const maxSize = useMemo(() => {
    const sizes = [...asks, ...bids].map((l) => l.size);
    return sizes.length ? Math.max(...sizes) : 0;
  }, [asks, bids]);

  const isLive = subData != null || book != null;
  const empty = !book || (asks.length === 0 && bids.length === 0);

  return (
    <section className="detail-section">
      <div className="detail-section-title">
        Order book
        {isLive && (
          <span className="live-pill" title="Streaming live depth">
            ● live
          </span>
        )}
      </div>
      {loading && !book ? (
        <div className="state-msg">Loading book…</div>
      ) : error && !book ? (
        <div className="state-msg state-err">{error.message}</div>
      ) : empty ? (
        <div className="state-msg">
          No live book — Polymarket-only; this market may be closed or one-sided.
        </div>
      ) : (
        <div className="ob">
          <div className="ob-side">
            {/* Render asks high→low so the lowest ask sits just above the mid. */}
            {[...asks].reverse().map((l, i) => (
              <ObRow key={`a${i}`} lvl={l} side="ask" maxSize={maxSize} />
            ))}
          </div>
          <div className="ob-mid">
            <span className="ob-mid-val num">{micToCents(book.midpointMicrodollars)}</span>
            <span className="ob-mid-label">mid</span>
            <span className="ob-spread">spread {micToCents(book.spreadMicrodollars)}</span>
          </div>
          <div className="ob-side">
            {bids.map((l, i) => (
              <ObRow key={`b${i}`} lvl={l} side="bid" maxSize={maxSize} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
