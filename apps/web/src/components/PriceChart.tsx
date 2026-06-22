import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@apollo/client";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath, AreaClosed } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import {
  GET_MARKET_PRICE_HISTORY,
  type GetMarketPriceHistoryResult,
  type GetMarketPriceHistoryVars,
  type PricePoint,
} from "@/gql/markets";

const INTERVALS: Array<{ key: string; label: string; fidelity: number }> = [
  { key: "1d", label: "1D", fidelity: 5 },
  { key: "1w", label: "1W", fidelity: 60 },
  { key: "1m", label: "1M", fidelity: 180 },
  { key: "max", label: "MAX", fidelity: 720 },
];

const HEIGHT = 240;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 };

/** Measure the container's width (visx needs explicit dims; no @visx/responsive dep). */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Primary-outcome price chart (Phase 1 detail-page enrichment). Plots the
 * probability series (0..100¢) from the public Polymarket CLOB over a selectable
 * window. Polymarket-only — Kalshi markets return an empty series and the chart
 * renders an empty-state note.
 */
export function PriceChart({ marketId }: { marketId: string }) {
  const [interval, setInterval] = useState("1w");
  const [ref, width] = useWidth();

  const fidelity = INTERVALS.find((i) => i.key === interval)?.fidelity ?? 60;
  const { data, loading } = useQuery<GetMarketPriceHistoryResult, GetMarketPriceHistoryVars>(
    GET_MARKET_PRICE_HISTORY,
    { variables: { marketId, interval, fidelity } },
  );

  const points: PricePoint[] = useMemo(
    () => (data?.marketPriceHistory ?? []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.p)),
    [data],
  );

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const { xScale, yScale } = useMemo(() => {
    const xs = points.map((p) => p.t * 1000);
    const x = scaleTime<number>({
      domain: xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1],
      range: [0, innerW],
    });
    // Probability axis in cents (0..100), padded slightly around the observed band.
    const cents = points.map((p) => p.p * 100);
    const lo = cents.length ? Math.max(0, Math.min(...cents) - 5) : 0;
    const hi = cents.length ? Math.min(100, Math.max(...cents) + 5) : 100;
    const y = scaleLinear<number>({ domain: [lo, hi], range: [innerH, 0] });
    return { xScale: x, yScale: y };
  }, [points, innerW, innerH]);

  const getX = (p: PricePoint) => xScale(p.t * 1000);
  const getY = (p: PricePoint) => yScale(p.p * 100);

  return (
    <div className="price-chart">
      <div className="price-chart-head">
        <span className="detail-section-title">Price history</span>
        <div className="price-chart-intervals">
          {INTERVALS.map((i) => (
            <button
              key={i.key}
              className={i.key === interval ? "chip chip-on" : "chip"}
              onClick={() => setInterval(i.key)}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={ref} className="price-chart-body">
        {loading && !points.length ? (
          <div className="state-msg">Loading…</div>
        ) : !points.length ? (
          <div className="state-msg">No price history (Polymarket markets only).</div>
        ) : (
          <svg width={width} height={HEIGHT}>
            <Group left={MARGIN.left} top={MARGIN.top}>
              <AreaClosed
                data={points}
                x={getX}
                y={getY}
                yScale={yScale}
                fill="var(--acc)"
                fillOpacity={0.12}
              />
              <LinePath data={points} x={getX} y={getY} stroke="var(--acc)" strokeWidth={1.5} />
              <AxisLeft
                scale={yScale}
                numTicks={4}
                tickFormat={(v) => `${Number(v).toFixed(0)}¢`}
                stroke="var(--line)"
                tickStroke="var(--line)"
                tickLabelProps={() => ({ fill: "var(--mut)", fontSize: 10, dx: -4, dy: 3, textAnchor: "end" })}
              />
              <AxisBottom
                scale={xScale}
                top={innerH}
                numTicks={5}
                stroke="var(--line)"
                tickStroke="var(--line)"
                tickLabelProps={() => ({ fill: "var(--mut)", fontSize: 10, dy: 2, textAnchor: "middle" })}
              />
            </Group>
          </svg>
        )}
      </div>
    </div>
  );
}
