import { createPublicClient, http, type PublicClient } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { AMOY_CHAIN_ID, POLYGON_CHAIN_ID, type SupportedChainId } from "./addresses.js";

/** viem public client for the given chain + RPC url. */
export function publicClientFor(chainId: SupportedChainId, rpcUrl: string): PublicClient {
  const chain = chainId === POLYGON_CHAIN_ID ? polygon : polygonAmoy;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export { polygon, polygonAmoy, POLYGON_CHAIN_ID, AMOY_CHAIN_ID };
