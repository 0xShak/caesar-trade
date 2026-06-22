import { useCallback } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  custom,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { polygon } from "viem/chains";
import { POLYGON_CHAIN_ID } from "@caesar/chain";

/**
 * Browser-side signing/sending through the user's Privy **embedded** wallet — the
 * one mechanism by which a real order/deploy/approval is authorized (the server
 * holds no key; see docs/PHASE3-LIVE-TRADING.md). Multi-tenant by construction:
 * each customer signs with their own embedded wallet in their own session.
 *
 * We wrap the embedded wallet's EIP-1193 provider in a viem wallet client pinned
 * to Polygon, so callers get `signTypedData` (EIP-712) + `sendTransaction` with
 * the same payloads `@caesar/chain` builds server-side and in tests.
 */

export interface TradingWalletApi {
  /** embedded EOA address (the order `signer`); undefined until Privy is ready. */
  address?: Address;
  ready: boolean;
  /** sign an EIP-712 payload (CreateProxy / SafeTx / ClobAuth / order). */
  signTypedData: (td: TypedDataDefinition) => Promise<Hex>;
  /** send a tx FROM the embedded EOA (deploy / approvals); returns the tx hash. */
  sendTx: (tx: { to: Address; data: Hex; value?: bigint }) => Promise<Hex>;
}

export function useTradingWallet(): TradingWalletApi {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  const getClient = useCallback(async () => {
    if (!embedded) throw new Error("No embedded wallet — log in first.");
    // Ensure the embedded wallet is on Polygon before signing/sending.
    try {
      await embedded.switchChain(POLYGON_CHAIN_ID);
    } catch {
      // switchChain throws if already on the chain in some Privy builds — ignore.
    }
    const provider = await embedded.getEthereumProvider();
    const account = embedded.address as Address;
    const client = createWalletClient({ account, chain: polygon, transport: custom(provider) });
    return { client, account };
  }, [embedded]);

  const signTypedData = useCallback(
    async (td: TypedDataDefinition) => {
      const { client, account } = await getClient();
      return client.signTypedData({ account, ...td });
    },
    [getClient],
  );

  const sendTx = useCallback(
    async (tx: { to: Address; data: Hex; value?: bigint }) => {
      const { client, account } = await getClient();
      return client.sendTransaction({
        account,
        chain: polygon,
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
      });
    },
    [getClient],
  );

  return { address: embedded?.address as Address | undefined, ready: !!embedded, signTypedData, sendTx };
}
