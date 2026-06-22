import { gql } from "@apollo/client";

/**
 * Trader read operations (public Polymarket data-API backed).
 *
 * Wire money contract (matches the rest of the API):
 *  - amount Floats (analytics.allTimeVolume / allTimePnl, onchain.usdcBalance,
 *    position costBasis / currentValue / unrealizedPnl / realizedPnl) are
 *    integer-valued **microdollars**.
 *  - avgEntryPrice / currentPrice are **probabilities 0..1**.
 * The pages normalize via `@/lib/money`.
 *
 * NOTE: `GetTraders` returns "active traders by recent volume" — a live list
 * derived from the recent global trade feed, NOT an all-time leaderboard.
 */

// --------------------------------------------------------------------------- //
// GetTraders — active-by-recent-volume list (+ address search)
// --------------------------------------------------------------------------- //

export const GET_TRADERS = gql`
  query GetTraders(
    $limit: Int
    $offset: Int
    $sortBy: String
    $search: String
  ) {
    traders(limit: $limit, offset: $offset, sortBy: $sortBy, search: $search) {
      data {
        id
        platform
        username
        displayName
        profileImageUrl
        isVerified
        analytics {
          allTimeVolume
          allTimePnl
          rank
        }
      }
      hasMore
      total
    }
  }
`;

export interface TraderAnalytics {
  allTimeVolume: number | null;
  allTimePnl: number | null;
  rank: number | null;
}

export interface TraderListItem {
  id: string;
  platform: string | null;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isVerified: boolean | null;
  analytics: TraderAnalytics | null;
}

export interface GetTradersResult {
  traders: {
    data: TraderListItem[] | null;
    hasMore: boolean | null;
    total: number | null;
  } | null;
}

export interface GetTradersVars {
  limit?: number;
  offset?: number;
  sortBy?: string | null;
  search?: string | null;
}

// --------------------------------------------------------------------------- //
// GetTrader — profile header
// --------------------------------------------------------------------------- //

export const GET_TRADER = gql`
  query GetTrader($id: ID) {
    trader(id: $id) {
      id
      platform
      username
      displayName
      profileImageUrl
      isVerified
      analytics {
        allTimeVolume
        allTimePnl
        rank
      }
      onchain {
        usdcBalance
      }
    }
  }
`;

export interface TraderOnchain {
  usdcBalance: number | null;
}

export interface TraderProfile {
  id: string;
  platform: string | null;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isVerified: boolean | null;
  analytics: TraderAnalytics | null;
  onchain: TraderOnchain | null;
}

export interface GetTraderResult {
  trader: TraderProfile | null;
}

export interface GetTraderVars {
  id: string;
}

// --------------------------------------------------------------------------- //
// GetTraderPositions — grouped open positions
// --------------------------------------------------------------------------- //

export const GET_TRADER_POSITIONS = gql`
  query GetTraderPositions($traderId: ID!) {
    traderPositions(traderId: $traderId) {
      data {
        marketId
        marketTitle
        marketTicker
        platform
        positions {
          outcome
          size
          avgEntryPrice
          currentPrice
          costBasis
          currentValue
          unrealizedPnl
          realizedPnl
          redeemable
        }
      }
      meta {
        isStale
        lastSyncedAt
        refreshTriggered
      }
    }
  }
`;

export interface TraderPosition {
  outcome: string | null;
  size: number | null;
  avgEntryPrice: number | null;
  currentPrice: number | null;
  costBasis: number | null;
  currentValue: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  redeemable: boolean | null;
}

export interface TraderPositionGroup {
  marketId: string | null;
  marketTitle: string | null;
  marketTicker: string | null;
  platform: string | null;
  positions: TraderPosition[] | null;
}

export interface SyncMeta {
  isStale: boolean | null;
  lastSyncedAt: string | null;
  refreshTriggered: boolean | null;
}

export interface GetTraderPositionsResult {
  traderPositions: {
    data: TraderPositionGroup[] | null;
    meta: SyncMeta | null;
  } | null;
}

export interface GetTraderPositionsVars {
  traderId: string;
}
