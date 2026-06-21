import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  GET_MARKETS,
  GET_TAGS,
  type GetMarketsResult,
  type GetMarketsVars,
  type GetTagsResult,
  type MarketFiltersInput,
  type MarketListItem,
  type ListOutcome,
} from "@/gql/markets";
import { fmtAmount, fmtProbCents, platformClass } from "@/lib/money";

const PAGE_SIZE = 50;

const SORTS = [
  { value: "volume", label: "Volume" },
  { value: "volume24h", label: "24h Volume" },
  { value: "liquidity", label: "Liquidity" },
  { value: "endDate", label: "End date" },
] as const;

const PLATFORMS = [
  { value: "", label: "All" },
  { value: "polymarket", label: "Polymarket" },
  { value: "kalshi", label: "Kalshi" },
] as const;

type SortBy = (typeof SORTS)[number]["value"];
type SortOrder = "asc" | "desc";

function primaryOutcome(m: MarketListItem): ListOutcome | undefined {
  const outcomes = m.outcomes ?? [];
  return outcomes.find((o) => o.isPrimary) ?? outcomes[0];
}

/** Read the current view state straight off the URL search params. */
interface ViewState {
  search: string;
  platform: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  tags: string[];
  page: number;
}

function parseState(params: URLSearchParams): ViewState {
  const sortByRaw = params.get("sortBy") ?? "volume";
  const sortBy = (SORTS.some((s) => s.value === sortByRaw)
    ? sortByRaw
    : "volume") as SortBy;
  const sortOrder = params.get("sortOrder") === "asc" ? "asc" : "desc";
  const page = Math.max(0, Number(params.get("page") ?? "0") | 0);
  const tagsRaw = params.get("tags");
  return {
    search: params.get("q") ?? "",
    platform: params.get("platform") ?? "",
    sortBy,
    sortOrder,
    tags: tagsRaw ? tagsRaw.split(",").filter(Boolean) : [],
    page,
  };
}

export function MarketsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const view = useMemo(() => parseState(params), [params]);

  // Local, debounced mirror of the search box so we don't refetch per keystroke.
  const [searchText, setSearchText] = useState(view.search);
  useEffect(() => {
    setSearchText(view.search);
  }, [view.search]);
  useEffect(() => {
    if (searchText === view.search) return;
    const t = setTimeout(() => {
      patch({ q: searchText || null, page: null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  /** Merge keys into the URL search params; null clears a key. */
  function patch(next: Record<string, string | null>) {
    setParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === "") sp.delete(k);
          else sp.set(k, v);
        }
        return sp;
      },
      { replace: true },
    );
  }

  const filterInput: MarketFiltersInput = {};
  if (view.platform) filterInput.platforms = [view.platform];
  if (view.tags.length) filterInput.includedTags = view.tags;

  const { data, loading, error } = useQuery<GetMarketsResult, GetMarketsVars>(
    GET_MARKETS,
    {
      variables: {
        limit: PAGE_SIZE,
        offset: view.page * PAGE_SIZE,
        sortBy: view.sortBy,
        sortOrder: view.sortOrder,
        search: view.search || null,
        filterInput,
      },
    },
  );

  const { data: tagData } = useQuery<GetTagsResult>(GET_TAGS);
  const tags = tagData?.tags ?? [];

  const conn = data?.markets;
  const markets = conn?.data ?? [];
  const total = conn?.total ?? 0;
  const hasMore = conn?.hasMore ?? false;
  const offset = view.page * PAGE_SIZE;

  function toggleTag(slug: string) {
    const next = view.tags.includes(slug)
      ? view.tags.filter((t) => t !== slug)
      : [...view.tags, slug];
    patch({ tags: next.length ? next.join(",") : null, page: null });
  }

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Markets</span>
        <span className="page-meta">
          {conn
            ? `${markets.length} shown · ${total} total`
            : loading
              ? "loading…"
              : ""}
        </span>
      </div>

      <div className="ctrl-bar">
        <input
          className="ctrl-input"
          type="search"
          placeholder="Search markets…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <select
          className="ctrl-select"
          value={view.platform}
          onChange={(e) => patch({ platform: e.target.value || null, page: null })}
          aria-label="Platform filter"
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <select
          className="ctrl-select"
          value={view.sortBy}
          onChange={(e) => patch({ sortBy: e.target.value, page: null })}
          aria-label="Sort by"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn ctrl-sortdir"
          onClick={() =>
            patch({
              sortOrder: view.sortOrder === "asc" ? "desc" : "asc",
              page: null,
            })
          }
          title={view.sortOrder === "asc" ? "Ascending" : "Descending"}
        >
          {view.sortOrder === "asc" ? "▲ Asc" : "▼ Desc"}
        </button>
      </div>

      {tags.length > 0 && (
        <div className="tag-row">
          {tags.map((t) => {
            const slug = t.slug ?? "";
            const active = view.tags.includes(slug);
            return (
              <button
                key={slug}
                type="button"
                className={active ? "tag-chip tag-chip-on" : "tag-chip"}
                onClick={() => toggleTag(slug)}
              >
                {t.label ?? slug}
                {t.activeMarketCount != null && (
                  <span className="tag-count">{t.activeMarketCount}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {loading && !data ? (
        <div className="state-msg">Loading markets…</div>
      ) : error ? (
        <div className="state-msg state-err">GraphQL error: {error.message}</div>
      ) : markets.length === 0 ? (
        <div className="state-msg">No markets match these filters.</div>
      ) : (
        <table className="mono-table">
          <thead>
            <tr>
              <th>Market</th>
              <th>Platform</th>
              <th>Status</th>
              <th className="num">Mid</th>
              <th className="num">24h Vol</th>
              <th className="num">Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const outcome = primaryOutcome(m);
              return (
                <tr
                  key={m.id}
                  className="row-link"
                  onClick={() => navigate(`/markets/${m.id}`)}
                >
                  <td title={m.question ?? undefined} style={{ maxWidth: 420 }}>
                    <Link
                      to={`/markets/${m.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {m.question ?? m.displayNameShort ?? m.id}
                    </Link>
                  </td>
                  <td>
                    <span className={platformClass(m.platform)}>
                      {m.platform ?? "—"}
                    </span>
                  </td>
                  <td>{m.status ?? "—"}</td>
                  <td className="num">{fmtProbCents(outcome?.midPoint)}</td>
                  <td className="num">{fmtAmount(m.volume24h, { compact: true })}</td>
                  <td className="num">{fmtAmount(m.liquidity, { compact: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="pager">
        <button
          type="button"
          className="btn"
          disabled={view.page === 0}
          onClick={() => patch({ page: String(view.page - 1) })}
        >
          ← Prev
        </button>
        <span className="page-meta">
          {total > 0
            ? `${offset + 1}–${offset + markets.length} of ${total}`
            : "—"}
        </span>
        <button
          type="button"
          className="btn"
          disabled={!hasMore}
          onClick={() => patch({ page: String(view.page + 1) })}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
