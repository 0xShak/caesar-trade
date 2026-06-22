import type { Address } from "viem";

/**
 * Polymarket contract address book — transcribed VERBATIM from
 * /root/parity-study/dossier-onchain-signing.md §2 (recovered from the
 * production bundle). [CONFIRMED] unless noted.
 *
 * chainId 137 = Polygon mainnet, 80002 = Polygon Amoy testnet.
 */

export const POLYGON_CHAIN_ID = 137 as const;
export const AMOY_CHAIN_ID = 80002 as const;
export type SupportedChainId = typeof POLYGON_CHAIN_ID | typeof AMOY_CHAIN_ID;

export interface PolymarketContracts {
  exchange: Address; // CTF Exchange V1
  negRiskExchange: Address; // NegRisk CTF Exchange V1
  negRiskAdapter: Address;
  collateral: Address; // see COLLATERAL_HAZARD below
  conditionalTokens: Address; // CTF (ERC1155)
  exchangeV2: Address;
  negRiskExchangeV2: Address;
}

/**
 * COLLATERAL — resolved 2026-06-22 (was flagged COLLATERAL_HAZARD).
 * `0xC011a7E1…2DFB` is NOT a placeholder: PolygonScan confirms it is the real
 * **pUSD** ("Polymarket USD") token — the collateral for the **CLOB V2** stack
 * on Polygon mainnet (ERC-20, ~$484M supply, EIP-1167 proxy). pUSD is backed by
 * USDC.e (`0x2791Bca1…84174`), wrapped/unwrapped via Polymarket's Collateral
 * onramp/offramp. The legacy V1 exchange traded directly in USDC.e.
 * So: V2 collateral = pUSD (this constant); V1 collateral = USDC.e.
 * Sources: docs.polymarket.com/concepts/pusd, PolygonScan. See docs/MAINNET-GATES.md.
 *
 * Still verify before mainnet: token DECIMALS + approval semantics against the
 * live contract, and the Amoy/testnet pUSD address (the bundle reuses the same
 * address for Amoy — UNVERIFIED).
 */
export const COLLATERAL_PUSD_V2: Address = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
/** @deprecated misnomer — this address is real pUSD, not a placeholder. Use COLLATERAL_PUSD_V2. */
export const COLLATERAL_PLACEHOLDER: Address = COLLATERAL_PUSD_V2;
export const CANONICAL_USDC_E_POLYGON: Address = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

export const MATIC_CONTRACTS: PolymarketContracts = {
  exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  collateral: COLLATERAL_PLACEHOLDER, // ⚠️ see COLLATERAL_HAZARD
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  exchangeV2: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRiskExchangeV2: "0xe2222d279d744050d28e00520010520000310F59",
};

export const AMOY_CONTRACTS: PolymarketContracts = {
  exchange: "0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40",
  negRiskExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  collateral: COLLATERAL_PLACEHOLDER,
  conditionalTokens: "0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB",
  exchangeV2: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRiskExchangeV2: "0xe2222d279d744050d28e00520010520000310F59",
};

export function contractsForChain(chainId: SupportedChainId): PolymarketContracts {
  return chainId === POLYGON_CHAIN_ID ? MATIC_CONTRACTS : AMOY_CONTRACTS;
}

/** Proxy / Safe / Relay infrastructure (chain-agnostic in the bundle). */
export const INFRA = {
  safeFactory: "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b",
  proxyFactory: "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052",
  depositWalletFactory: "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07",
  relayHub: "0xD216153c06E857cD7f72665E0aF1d7D82172F494",
  zeroAddress: "0x0000000000000000000000000000000000000000",
} as const satisfies Record<string, Address>;

/** CREATE2 init-code hashes for deterministic wallet derivation (dossier §2.5). */
export const PROXY_INIT_CODE_HASH =
  "0xd21df8dc65880a8606f09fe0ce3df9b8869287ab0b058be05aa9e8af6330a00b" as const;
export const SAFE_INIT_CODE_HASH =
  "0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf" as const;

/** Hosts (dossier §6.1). */
export const HOSTS = {
  clob: "https://clob.polymarket.com",
  relayer: "https://relayer-v2.polymarket.com",
  gamma: "https://gamma-api.polymarket.com",
  clobWs: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  geoblock: "https://polymarket.com/api/geoblock",
} as const;
