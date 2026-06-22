import { gql } from "@apollo/client";

/**
 * Caesar SDL extension: live CLOB orderbook depth (Polymarket-only). `GET_MARKET_ORDERBOOK`
 * fetches the initial snapshot; `ORDERBOOK_UPDATES_SUB` streams the book over the
 * graphql-ws link whenever it changes (deduped server-side by hash). `price` is the
 * 0..1 probability for display; `priceMicrodollars` is micro-USD per share.
 */

const ORDERBOOK_FIELDS = `
  tokenId
  midpointMicrodollars
  spreadMicrodollars
  tickSize
  timestamp
  hash
  bids {
    price
    priceMicrodollars
    size
  }
  asks {
    price
    priceMicrodollars
    size
  }
`;

export const GET_MARKET_ORDERBOOK = gql`
  query GetMarketOrderbook($marketId: ID!) {
    marketOrderbook(marketId: $marketId) {
      ${ORDERBOOK_FIELDS}
    }
  }
`;

export const ORDERBOOK_UPDATES_SUB = gql`
  subscription OrderbookUpdates($marketId: ID!) {
    orderbookUpdates(marketId: $marketId) {
      ${ORDERBOOK_FIELDS}
    }
  }
`;

export interface OrderbookLevel {
  price: number;
  priceMicrodollars: number;
  size: number;
}

export interface Orderbook {
  tokenId: string | null;
  midpointMicrodollars: number | null;
  spreadMicrodollars: number | null;
  tickSize: number | null;
  timestamp: number | null;
  hash: string | null;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface GetMarketOrderbookResult {
  marketOrderbook: Orderbook | null;
}

export interface OrderbookUpdatesResult {
  orderbookUpdates: Orderbook | null;
}

export interface OrderbookVars {
  marketId: string;
}
