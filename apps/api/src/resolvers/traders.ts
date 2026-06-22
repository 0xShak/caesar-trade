/**
 * Trader resolvers, backed by public Polymarket data-API endpoints (no auth):
 *   - GET /value?user=<addr>          → portfolio value (dollars)
 *   - GET /positions?user=<addr>      → open positions (dollars / 0..1 prices)
 *   - GET /trades?limit=…             → recent global trade feed
 *
 * Money discipline (matches the rest of the API): amount fields are exposed as
 * integer **microdollars** (`Math.round(dollars * 1e6)`); price fields
 * (avgEntryPrice / currentPrice) are probabilities 0..1 as-is.
 *
 * Network failures never throw to the client: every fetch path degrades to
 * null / [] / an empty connection.
 *
 * IMPORTANT: the `traders` list is "active traders by recent volume" — a *live*
 * list derived from the recent global /trades feed. It is NOT an all-time
 * leaderboard; we only surface what these public endpoints actually return.
 */

const POLY_DATA_API = "https://data-api.polymarket.com";

// --------------------------------------------------------------------------- //
// Argument shapes
// --------------------------------------------------------------------------- //

export interface TradersArgs {
  limit?: number | null;
  offset?: number | null;
  sortBy?: string | null;
  sortOrder?: string | null;
  search?: string | null;
}

export interface TraderArgs {
  id?: string | null;
  identifier?: string | null;
  platform?: string | null;
}

export interface ResolveTraderArgs {
  identifier: string;
  platform?: string | null;
}

export interface TraderPositionsArgs {
  traderId: string;
  platform?: string | null;
}

// --------------------------------------------------------------------------- //
// Shared fetch helper (small, with timeout). Returns null on any failure.
// --------------------------------------------------------------------------- //

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------- //
// Venue JSON shapes (only the fields we read)
// --------------------------------------------------------------------------- //

interface PolyValueEntry {
  user?: string | null;
  value?: number | null;
}

interface PolyPosition {
  proxyWallet?: string | null;
  asset?: string | null;
  conditionId?: string | null;
  size?: number | null;
  avgPrice?: number | null;
  initialValue?: number | null;
  currentValue?: number | null;
  cashPnl?: number | null;
  percentPnl?: number | null;
  curPrice?: number | null;
  totalBought?: number | null;
  realizedPnl?: number | null;
  redeemable?: boolean | null;
  title?: string | null;
  slug?: string | null;
  icon?: string | null;
}

interface PolyTrade {
  proxyWallet?: string | null;
  side?: string | null;
  asset?: string | null;
  conditionId?: string | null;
  size?: number | null;
  price?: number | null;
  timestamp?: number | null;
  title?: string | null;
  name?: string | null;
  pseudonym?: string | null;
  profileImage?: string | null;
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isAddress(s: string | null | undefined): s is string {
  return !!s && ADDRESS_RE.test(s.trim());
}

/** Short address form, e.g. `0xabcd…ef01`. */
function shortAddress(addr: string): string {
  if (addr.length <= 11) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function toMicro(dollars: number | null | undefined): number {
  return Math.round(Number(dollars ?? 0) * 1e6);
}

// --------------------------------------------------------------------------- //
// trader / resolveTrader
// --------------------------------------------------------------------------- //

async function loadTrader(addrRaw: string | null | undefined) {
  if (!isAddress(addrRaw)) return null;
  const addr = addrRaw.trim();

  try {
    const valueUrl = `${POLY_DATA_API}/value?user=${encodeURIComponent(addr)}`;
    const positionsUrl = `${POLY_DATA_API}/positions?user=${encodeURIComponent(
      addr,
    )}&limit=200&sortBy=CURRENT&sortDirection=DESC`;

    const [valueData, positionsData] = await Promise.all([
      fetchJson<PolyValueEntry[]>(valueUrl),
      fetchJson<PolyPosition[]>(positionsUrl),
    ]);

    const valueArr = Array.isArray(valueData) ? valueData : [];
    const positions = Array.isArray(positionsData) ? positionsData : [];

    // Null only when the wallet has neither a value entry nor any positions.
    if (valueArr.length === 0 && positions.length === 0) return null;

    const portfolioDollars = valueArr[0]?.value ?? 0;
    let pnlDollars = 0;
    let volumeDollars = 0;
    for (const p of positions) {
      pnlDollars += Number(p.cashPnl ?? 0);
      volumeDollars += Number(p.initialValue ?? 0);
    }

    // Best-effort username / avatar enrichment: scan a recent global trades
    // page for a trade by this wallet and lift its profile fields.
    let username: string | null = null;
    let displayName: string | null = null;
    let profileImageUrl: string | null = null;
    const trades = await fetchJson<PolyTrade[]>(
      `${POLY_DATA_API}/trades?limit=200&takerOnly=false`,
    );
    if (Array.isArray(trades)) {
      const match = trades.find(
        (t) => (t.proxyWallet ?? "").toLowerCase() === addr.toLowerCase(),
      );
      if (match) {
        username = match.name ?? null;
        displayName = match.pseudonym ?? match.name ?? null;
        profileImageUrl = match.profileImage ?? null;
      }
    }

    return {
      id: addr,
      platform: "polymarket",
      platformId: addr,
      username,
      displayName: displayName ?? shortAddress(addr),
      customDisplayName: null,
      profileImageUrl,
      isVerified: false,
      socialTwitter: null,
      badges: null,
      bio: null,
      analytics: {
        allTimeVolume: toMicro(volumeDollars),
        allTimePnl: toMicro(pnlDollars),
        rank: null,
      },
      onchain: {
        usdcBalance: toMicro(portfolioDollars),
        accountAgeDays: null,
        firstTransactionDate: null,
      },
    };
  } catch {
    return null;
  }
}

export function resolveTrader(args: TraderArgs) {
  return loadTrader(args.id ?? args.identifier);
}

export function resolveResolveTrader(args: ResolveTraderArgs) {
  return loadTrader(args.identifier);
}

// --------------------------------------------------------------------------- //
// traderPositions
// --------------------------------------------------------------------------- //

export async function resolveTraderPositions(args: TraderPositionsArgs) {
  const nowIso = new Date().toISOString();
  const empty = {
    data: [],
    meta: { isStale: false, lastSyncedAt: nowIso, refreshTriggered: false },
  };

  if (!isAddress(args.traderId)) return empty;
  const addr = args.traderId.trim();

  try {
    const url = `${POLY_DATA_API}/positions?user=${encodeURIComponent(
      addr,
    )}&limit=200&sortBy=CURRENT&sortDirection=DESC`;
    const data = await fetchJson<PolyPosition[]>(url);
    if (!Array.isArray(data)) return empty;

    // Group positions by conditionId → one TraderPositionGroup per market.
    const groups = new Map<
      string,
      {
        marketId: string;
        marketTitle: string | null;
        marketTicker: string | null;
        platform: string;
        positions: unknown[];
      }
    >();

    for (const p of data) {
      const conditionId = p.conditionId ?? "";
      let group = groups.get(conditionId);
      if (!group) {
        group = {
          marketId: `polymarket:${conditionId}`,
          marketTitle: p.title ?? null,
          marketTicker: p.slug ?? null,
          platform: "polymarket",
          positions: [],
        };
        groups.set(conditionId, group);
      }
      group.positions.push({
        outcome: null,
        size: Number(p.size ?? 0),
        avgEntryPrice: p.avgPrice ?? null,
        currentPrice: p.curPrice ?? null,
        costBasis: toMicro(p.initialValue),
        currentValue: toMicro(p.currentValue),
        unrealizedPnl: toMicro(p.cashPnl),
        realizedPnl: toMicro(p.realizedPnl),
        redeemable: p.redeemable ?? null,
      });
    }

    return {
      data: [...groups.values()],
      meta: { isStale: false, lastSyncedAt: nowIso, refreshTriggered: false },
    };
  } catch {
    return empty;
  }
}

// --------------------------------------------------------------------------- //
// traders — "active traders by recent volume" (LIVE derived list)
// --------------------------------------------------------------------------- //

export async function resolveTraders(args: TradersArgs) {
  const limit = args.limit ?? 25;
  const offset = args.offset ?? 0;
  const empty = { data: [], hasMore: false, total: 0 };

  try {
    // Address search → single trader looked up by /value + /positions.
    if (isAddress(args.search)) {
      const t = await loadTrader(args.search);
      if (!t) return empty;
      const item = {
        id: t.id,
        platform: "polymarket",
        platformId: t.platformId,
        username: t.username,
        displayName: t.displayName,
        customDisplayName: null,
        profileImageUrl: t.profileImageUrl,
        isVerified: false,
        badges: null,
        analytics: {
          allTimeVolume: t.analytics.allTimeVolume,
          allTimePnl: t.analytics.allTimePnl,
          rank: 1,
        },
      };
      return { data: [item], hasMore: false, total: 1 };
    }

    // Otherwise aggregate the recent global /trades feed by proxyWallet. This is
    // a LIVE "active by recent volume" list, NOT an all-time leaderboard.
    const trades = await fetchJson<PolyTrade[]>(
      `${POLY_DATA_API}/trades?limit=500&takerOnly=false`,
    );
    if (!Array.isArray(trades)) return empty;

    interface Agg {
      wallet: string;
      volumeMicro: number;
      username: string | null;
      pseudonym: string | null;
      profileImage: string | null;
    }
    const byWallet = new Map<string, Agg>();

    for (const t of trades) {
      const wallet = t.proxyWallet ?? "";
      if (!wallet) continue;
      const price = Number(t.price ?? 0);
      const size = Number(t.size ?? 0);
      const notionalMicro = Math.round(price * size * 1e6);
      let agg = byWallet.get(wallet);
      if (!agg) {
        agg = {
          wallet,
          volumeMicro: 0,
          username: t.name ?? null,
          pseudonym: t.pseudonym ?? null,
          profileImage: t.profileImage ?? null,
        };
        byWallet.set(wallet, agg);
      }
      agg.volumeMicro += notionalMicro;
    }

    const ranked = [...byWallet.values()].sort(
      (a, b) => b.volumeMicro - a.volumeMicro,
    );
    const total = ranked.length;
    const page = ranked.slice(offset, offset + limit);

    const data = page.map((agg, i) => ({
      id: agg.wallet,
      platform: "polymarket",
      platformId: agg.wallet,
      username: agg.username,
      displayName: agg.pseudonym ?? agg.username ?? shortAddress(agg.wallet),
      customDisplayName: null,
      profileImageUrl: agg.profileImage,
      isVerified: false,
      badges: null,
      analytics: {
        allTimeVolume: agg.volumeMicro,
        allTimePnl: null,
        rank: offset + i + 1,
      },
    }));

    return { data, hasMore: offset + page.length < total, total };
  } catch {
    return empty;
  }
}
