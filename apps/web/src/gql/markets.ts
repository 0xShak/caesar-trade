import { gql } from "@apollo/client";

/**
 * Markets read operations (bible §4 entity model).
 *
 * Wire money contract:
 *  - amount Floats (volume, liquidity, volume24h, totalOpenInterest, …) are
 *    integer-valued **microdollars**.
 *  - outcome `midPoint` / `spread` are **probabilities 0..1**.
 *  - `tickSize` is the actual tick (e.g. 0.001); `feeRate` is 0..1.
 * The pages normalize via `@/lib/money`.
 */

// --------------------------------------------------------------------------- //
// GetMarkets — list/browser
// --------------------------------------------------------------------------- //

export const GET_MARKETS = gql`
  query GetMarkets(
    $limit: Int!
    $offset: Int!
    $sortBy: String
    $sortOrder: String
    $search: String
    $filterInput: MarketFiltersInput
  ) {
    markets(
      limit: $limit
      offset: $offset
      sortBy: $sortBy
      sortOrder: $sortOrder
      search: $search
      filterInput: $filterInput
    ) {
      data {
        id
        question
        displayNameShort
        eventTitle
        slug
        platform
        status
        endDate
        volume
        volume24h
        liquidity
        outcomes {
          outcomeId
          outcomeName
          midPoint
          isPrimary
        }
        platformMarkets {
          platform
          externalId
          tickSize
          negRisk
        }
      }
      hasMore
      total
    }
  }
`;

export interface MarketFiltersInput {
  platforms?: string[];
  includedTags?: string[];
  status?: string;
}

export interface ListOutcome {
  outcomeId: string;
  outcomeName: string | null;
  midPoint: number | null;
  isPrimary: boolean | null;
}

export interface ListPlatformMarket {
  platform: string | null;
  externalId: string | null;
  tickSize: number | null;
  negRisk: boolean | null;
}

export interface MarketListItem {
  id: string;
  question: string | null;
  displayNameShort: string | null;
  eventTitle: string | null;
  slug: string | null;
  platform: string | null;
  status: string | null;
  endDate: string | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  outcomes: ListOutcome[] | null;
  platformMarkets: ListPlatformMarket[] | null;
}

export interface GetMarketsResult {
  markets: {
    data: MarketListItem[] | null;
    hasMore: boolean | null;
    total: number | null;
  } | null;
}

export interface GetMarketsVars {
  limit: number;
  offset: number;
  sortBy?: string;
  sortOrder?: string;
  search?: string | null;
  filterInput?: MarketFiltersInput;
}

// --------------------------------------------------------------------------- //
// GetTags — tag chips
// --------------------------------------------------------------------------- //

export const GET_TAGS = gql`
  query GetTags($search: String) {
    tags(search: $search) {
      slug
      label
      activeMarketCount
    }
  }
`;

export interface Tag {
  slug: string | null;
  label: string | null;
  activeMarketCount: number | null;
}

export interface GetTagsResult {
  tags: Tag[] | null;
}

export interface GetTagsVars {
  search?: string | null;
}

// --------------------------------------------------------------------------- //
// GetMarket — detail
// --------------------------------------------------------------------------- //

export const GET_MARKET = gql`
  query GetMarket($id: ID) {
    market(id: $id) {
      id
      eventId
      question
      displayNameShort
      description
      status
      platform
      slug
      endDate
      volume
      liquidity
      totalOpenInterest
      outcomes {
        outcomeId
        externalOutcomeId
        outcomeName
        isPrimary
        midPoint
        spread
        result
        outcomeIndex
      }
      platformMarkets {
        id
        platform
        externalId
        platformSlug
        displayNameShort
        eventTitle
        endDate
        tickSize
        minimumOrderSize
        feeRate
        feeRateBps
        negRisk
      }
      netFlowVolumes {
        volume1hMicrodollars
        volume24hMicrodollars
        volume1hChangePct
        volume24hChangePct
      }
    }
  }
`;

export interface DetailOutcome {
  outcomeId: string | null;
  externalOutcomeId: string | null;
  outcomeName: string | null;
  isPrimary: boolean | null;
  midPoint: number | null;
  spread: number | null;
  result: string | null;
  outcomeIndex: number | null;
}

export interface DetailPlatformMarket {
  id: string | null;
  platform: string | null;
  externalId: string | null;
  platformSlug: string | null;
  displayNameShort: string | null;
  eventTitle: string | null;
  endDate: string | null;
  tickSize: number | null;
  minimumOrderSize: number | null;
  feeRate: number | null;
  feeRateBps: number | null;
  negRisk: boolean | null;
}

export interface NetFlowVolumes {
  volume1hMicrodollars: number | null;
  volume24hMicrodollars: number | null;
  volume1hChangePct: number | null;
  volume24hChangePct: number | null;
}

export interface MarketDetail {
  id: string;
  eventId: string | null;
  question: string | null;
  displayNameShort: string | null;
  description: string | null;
  status: string | null;
  platform: string | null;
  slug: string | null;
  endDate: string | null;
  volume: number | null;
  liquidity: number | null;
  totalOpenInterest: number | null;
  outcomes: DetailOutcome[] | null;
  platformMarkets: DetailPlatformMarket[] | null;
  netFlowVolumes: NetFlowVolumes | null;
}

export interface GetMarketResult {
  market: MarketDetail | null;
}

export interface GetMarketVars {
  id: string;
}

// --------------------------------------------------------------------------- //
// GetMarketTrades — live recent-trades tape (public venue data-APIs)
// --------------------------------------------------------------------------- //

export const GET_MARKET_TRADES = gql`
  query GetMarketTrades($marketId: ID!, $limit: Int) {
    marketRecentTrades(marketId: $marketId, limit: $limit) {
      key
      transactionHash
      side
      price
      size
      totalValue
      datetime
      platform
      outcomeName
      trader {
        id
        displayName
      }
    }
  }
`;

export interface TradeTrader {
  id: string | null;
  displayName: string | null;
}

export interface RecentTrade {
  key: string | null;
  transactionHash: string | null;
  side: string | null;
  price: number | null;
  size: number | null;
  totalValue: number | null;
  datetime: string | null;
  platform: string | null;
  outcomeName: string | null;
  trader: TradeTrader | null;
}

export interface GetMarketTradesResult {
  marketRecentTrades: RecentTrade[] | null;
}

export interface GetMarketTradesVars {
  marketId: string;
  limit?: number;
}

// --------------------------------------------------------------------------- //
// MarketTrades — live tape subscription (graphql-ws over the WS link)
// --------------------------------------------------------------------------- //

/**
 * Streams new trades for a market as they land. Mirrors the GetMarketTrades row
 * shape so subscription payloads slot straight into the existing tape; uses
 * `transactionHash` as the stable dedupe key. (BaseTrade has no `key`/`platform`
 * /`trader.id`, so those are omitted vs. the backfill query.)
 */
export const MARKET_TRADES_SUB = gql`
  subscription MarketTrades($marketId: ID!) {
    marketTrades(marketId: $marketId) {
      transactionHash
      side
      price
      size
      totalValue
      datetime
      outcomeName
      marketQuestion
      trader {
        displayName
      }
    }
  }
`;

export interface SubTradeTrader {
  displayName: string | null;
}

export interface SubTrade {
  transactionHash: string | null;
  side: string | null;
  price: number | null;
  size: number | null;
  totalValue: number | null;
  datetime: string | null;
  outcomeName: string | null;
  marketQuestion: string | null;
  trader: SubTradeTrader | null;
}

export interface MarketTradesSubResult {
  marketTrades: SubTrade | null;
}

export interface MarketTradesSubVars {
  marketId: string;
}

// --------------------------------------------------------------------------- //
// GetMarketPositions — top holders panel (Polymarket only)
// --------------------------------------------------------------------------- //

export const GET_MARKET_POSITIONS = gql`
  query GetMarketPositions($marketId: ID!) {
    marketPositions(marketId: $marketId) {
      outcomeId
      outcome
      outcomeIndex
      positions {
        proxyWallet
        size
        trader {
          id
          displayName
        }
      }
    }
  }
`;

export interface PositionHolder {
  proxyWallet: string | null;
  size: number | null;
  trader: TradeTrader | null;
}

export interface PositionGroup {
  outcomeId: string | null;
  outcome: string | null;
  outcomeIndex: number | null;
  positions: PositionHolder[] | null;
}

export interface GetMarketPositionsResult {
  marketPositions: PositionGroup[] | null;
}

export interface GetMarketPositionsVars {
  marketId: string;
}

// --------------------------------------------------------------------------- //
// GetMarketPriceHistory — primary-outcome price series for the detail chart
// (t = unix seconds, p = probability 0..1; Polymarket-only).
// --------------------------------------------------------------------------- //

export const GET_MARKET_PRICE_HISTORY = gql`
  query GetMarketPriceHistory($marketId: ID!, $interval: String, $fidelity: Int) {
    marketPriceHistory(marketId: $marketId, interval: $interval, fidelity: $fidelity) {
      t
      p
    }
  }
`;

export interface PricePoint {
  t: number;
  p: number;
}

export interface GetMarketPriceHistoryResult {
  marketPriceHistory: PricePoint[] | null;
}

export interface GetMarketPriceHistoryVars {
  marketId: string;
  interval?: string;
  fidelity?: number;
}
