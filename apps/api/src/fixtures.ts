/**
 * Mock normalized-market fixtures for Phase 0. These mirror the unified shape
 * the SDL expects: a `Market` with `outcomes[]` (Parity-internal `outcomeId`
 * vs venue `externalOutcomeId`, `midPoint` as a 0..1 price) and
 * `platformMarkets[]` (one per venue, carrying `externalId`, `tickSize`,
 * `minimumOrderSize`, `negRisk`, `feeRate`). A mix of Polymarket (binary
 * YES/NO, clobTokenId-like external outcome ids) and Kalshi (ticker-based).
 *
 * Values are plausible but invented — this is mock data, not live state.
 */

export interface FixtureOutcome {
  outcomeId: string;
  externalOutcomeId: string;
  outcomeName: string;
  isPrimary: boolean;
  midPoint: number;
  spread: number;
  result: "YES" | "NO" | null;
}

export interface FixturePlatformMarket {
  id: string;
  marketId: string;
  externalId: string;
  platform: "polymarket" | "kalshi";
  platformSlug: string;
  tickSize: number;
  minimumOrderSize: number;
  feeRateBps: number;
  feeRate: number;
  negRisk: boolean;
  eventTitle: string;
}

export interface FixtureTag {
  slug: string;
  label: string;
  activeMarketCount: number;
}

export interface FixtureMarket {
  id: string;
  eventId: string;
  question: string;
  displayNameShort: string;
  description: string;
  status: "active";
  volume: number;
  liquidity: number;
  totalOpenInterest: number;
  slug: string;
  platform: "polymarket" | "kalshi";
  startDate: string;
  endDate: string;
  resolutionDate: string;
  icon: string;
  outcomes: FixtureOutcome[];
  platformMarkets: FixturePlatformMarket[];
  tags: FixtureTag[];
  netFlowVolumes: {
    volume1hMicrodollars: number;
    volume24hMicrodollars: number;
    volume1hChangePct: number;
    volume24hChangePct: number;
  };
  volume1h: number;
  volume24h: number;
  volume1hChangePct: number;
  volume24hChangePct: number;
}

export const tags: FixtureTag[] = [
  { slug: "politics", label: "Politics", activeMarketCount: 412 },
  { slug: "crypto", label: "Crypto", activeMarketCount: 188 },
  { slug: "economics", label: "Economics", activeMarketCount: 96 },
  { slug: "sports", label: "Sports", activeMarketCount: 524 },
];

export const markets: FixtureMarket[] = [
  {
    id: "mkt_us_election_2028",
    eventId: "evt_us_election_2028",
    question: "Will a Democrat win the 2028 US Presidential Election?",
    displayNameShort: "Dem wins 2028",
    description:
      "Resolves YES if the Democratic Party nominee wins the 2028 US Presidential Election.",
    status: "active",
    volume: 18420331.55,
    liquidity: 942100.12,
    totalOpenInterest: 3210045.0,
    slug: "will-a-democrat-win-the-2028-us-presidential-election",
    platform: "polymarket",
    startDate: "2025-11-06T00:00:00.000Z",
    endDate: "2028-11-07T00:00:00.000Z",
    resolutionDate: "2028-11-08T00:00:00.000Z",
    icon: "https://cdn.caesar.example/icons/election2028.png",
    outcomes: [
      {
        outcomeId: "out_dem2028_yes",
        externalOutcomeId:
          "71321045679252212594626385532706912750332728571942532289631379312455583992563",
        outcomeName: "Yes",
        isPrimary: true,
        midPoint: 0.47,
        spread: 0.02,
        result: null,
      },
      {
        outcomeId: "out_dem2028_no",
        externalOutcomeId:
          "52114319501245915516055106046884209969926127482827954674443846427813813222426",
        outcomeName: "No",
        isPrimary: false,
        midPoint: 0.53,
        spread: 0.02,
        result: null,
      },
    ],
    platformMarkets: [
      {
        id: "pm_poly_dem2028",
        marketId: "mkt_us_election_2028",
        externalId:
          "0x26d06d9c6303c11bf7388cff707e4dac836e03628630720bca3d8cbf4234713d",
        platform: "polymarket",
        platformSlug: "will-a-democrat-win-the-2028-us-presidential-election",
        tickSize: 0.01,
        minimumOrderSize: 5,
        feeRateBps: 0,
        feeRate: 0,
        negRisk: true,
        eventTitle: "2028 US Presidential Election",
      },
    ],
    tags: [tags[0]!, tags[2]!],
    netFlowVolumes: {
      volume1hMicrodollars: 31204500000,
      volume24hMicrodollars: 884200100000,
      volume1hChangePct: 4.2,
      volume24hChangePct: -1.8,
    },
    volume1h: 31204.5,
    volume24h: 884200.1,
    volume1hChangePct: 4.2,
    volume24hChangePct: -1.8,
  },
  {
    id: "mkt_btc_100k_eoy",
    eventId: "evt_btc_price_2026",
    question: "Will Bitcoin close above $100,000 by Dec 31, 2026?",
    displayNameShort: "BTC > $100k EOY",
    description:
      "Resolves YES if the BTC/USD spot price is at or above $100,000 at 2026-12-31 23:59 UTC.",
    status: "active",
    volume: 6021984.4,
    liquidity: 412300.0,
    totalOpenInterest: 1180220.5,
    slug: "will-bitcoin-close-above-100000-by-dec-31-2026",
    platform: "polymarket",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T23:59:00.000Z",
    resolutionDate: "2027-01-01T00:00:00.000Z",
    icon: "https://cdn.caesar.example/icons/btc100k.png",
    outcomes: [
      {
        outcomeId: "out_btc100k_yes",
        externalOutcomeId:
          "10883430389271199020315023421940492073445555932270010883220985518111223491017",
        outcomeName: "Yes",
        isPrimary: true,
        midPoint: 0.71,
        spread: 0.01,
        result: null,
      },
      {
        outcomeId: "out_btc100k_no",
        externalOutcomeId:
          "98221034509128340985213098451209348509128340958120934850912834095812093485091",
        outcomeName: "No",
        isPrimary: false,
        midPoint: 0.29,
        spread: 0.01,
        result: null,
      },
    ],
    platformMarkets: [
      {
        id: "pm_poly_btc100k",
        marketId: "mkt_btc_100k_eoy",
        externalId:
          "0x9f2b3c8d1e4a5f6079b8c0d2e1f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
        platform: "polymarket",
        platformSlug: "will-bitcoin-close-above-100000-by-dec-31-2026",
        tickSize: 0.01,
        minimumOrderSize: 5,
        feeRateBps: 100,
        feeRate: 0.01,
        negRisk: false,
        eventTitle: "Bitcoin Price 2026",
      },
    ],
    tags: [tags[1]!, tags[2]!],
    netFlowVolumes: {
      volume1hMicrodollars: 12044000000,
      volume24hMicrodollars: 301220900000,
      volume1hChangePct: 9.6,
      volume24hChangePct: 12.3,
    },
    volume1h: 12044.0,
    volume24h: 301220.9,
    volume1hChangePct: 9.6,
    volume24hChangePct: 12.3,
  },
  {
    id: "mkt_fed_rate_cut_jul",
    eventId: "evt_fomc_2026_07",
    question: "Will the Fed cut rates at the July 2026 FOMC meeting?",
    displayNameShort: "Fed cut (Jul '26)",
    description:
      "Resolves YES if the FOMC lowers the target federal funds rate at its July 2026 meeting.",
    status: "active",
    volume: 2210440.0,
    liquidity: 158900.0,
    totalOpenInterest: 540110.25,
    slug: "fed-rate-cut-july-2026",
    platform: "kalshi",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-07-29T18:00:00.000Z",
    resolutionDate: "2026-07-29T19:00:00.000Z",
    icon: "https://cdn.caesar.example/icons/fomc.png",
    outcomes: [
      {
        outcomeId: "out_fedcut_yes",
        externalOutcomeId: "FED-26JUL-C0.25-YES",
        outcomeName: "Yes",
        isPrimary: true,
        midPoint: 0.38,
        spread: 0.01,
        result: null,
      },
      {
        outcomeId: "out_fedcut_no",
        externalOutcomeId: "FED-26JUL-C0.25-NO",
        outcomeName: "No",
        isPrimary: false,
        midPoint: 0.62,
        spread: 0.01,
        result: null,
      },
    ],
    platformMarkets: [
      {
        id: "pm_kalshi_fedcut",
        marketId: "mkt_fed_rate_cut_jul",
        externalId: "FED-26JUL-C0.25",
        platform: "kalshi",
        platformSlug: "fed-rate-cut-july-2026",
        tickSize: 0.01,
        minimumOrderSize: 1,
        feeRateBps: 0,
        feeRate: 0,
        negRisk: false,
        eventTitle: "July 2026 FOMC Decision",
      },
    ],
    tags: [tags[2]!, tags[0]!],
    netFlowVolumes: {
      volume1hMicrodollars: 4480000000,
      volume24hMicrodollars: 110522000000,
      volume1hChangePct: -2.1,
      volume24hChangePct: 5.4,
    },
    volume1h: 4480.0,
    volume24h: 110522.0,
    volume1hChangePct: -2.1,
    volume24hChangePct: 5.4,
  },
];
