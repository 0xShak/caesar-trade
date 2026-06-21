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
