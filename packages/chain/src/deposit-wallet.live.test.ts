import { describe, expect, it } from "vitest";
import { encodeFunctionData, hashTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assembleType3ClobAuthSignature,
  assembleType3OrderSignature,
  buildType3ClobAuthTypedData,
  buildType3OrderTypedData,
  deriveDepositWalletAddress,
  type ClobAuthValue,
} from "./deposit-wallet.js";
import { buildV2LimitOrder, buildV2OrderTypedData, exchangeContractFor } from "./orders.js";
import { OrderSide, SignatureType } from "./eip712.js";
import { POLYGON_CHAIN_ID } from "./addresses.js";

const RPC = process.env.RPC!;
const PK = process.env.PROBE_PK as Hex;
const ERC1271_MAGIC = "0x1626ba7e";

const ISVALID_ABI = [
  {
    name: "isValidSignature",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "bytes" }],
    outputs: [{ type: "bytes4" }],
  },
] as const;

async function ethCall(to: string, data: Hex) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  return (await r.json()) as { result?: string; error?: { message: string } };
}

async function isValidSignature(wallet: string, digest: Hex, sig: Hex): Promise<string> {
  const data = encodeFunctionData({ abi: ISVALID_ABI, functionName: "isValidSignature", args: [digest, sig] });
  const res = await ethCall(wallet, data);
  if (res.error) return `ERR:${res.error.message}`;
  return (res.result ?? "0x").slice(0, 10);
}

// Network + a funded-by-relayer throwaway wallet required. Run explicitly with
// `RPC=… PROBE_PK=0x… vitest run src/deposit-wallet.live.test.ts`. Skipped otherwise.
describe.runIf(process.env.PROBE_PK && process.env.RPC)("LIVE deposit-wallet type-3 ERC-1271 validation", () => {
  it("relayer-deployed wallet validates order + clobauth signatures on-chain", async () => {
    const account = privateKeyToAccount(PK);
    const wallet = deriveDepositWalletAddress(account.address);

    // poll until the relayer-deployed wallet has code
    let deployed = false;
    for (let i = 0; i < 40; i++) {
      const d = (await (
        await fetch(`https://relayer-v2.polymarket.com/deployed?address=${wallet}&type=WALLET`)
      ).json()) as { deployed?: boolean };
      if (d.deployed) {
        deployed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(deployed, "wallet deployed").toBe(true);

    const exchange = exchangeContractFor(POLYGON_CHAIN_ID, false);

    // --- ORDER (sigType 3) ---
    const order = buildV2LimitOrder({
      funder: wallet,
      signer: wallet,
      tokenId: 71321045679252212594626385532706912750332728571942532289631379312455583992563n,
      side: OrderSide.BUY,
      signatureType: SignatureType.POLY_1271,
      salt: 999n,
      timestamp: 1_700_000_000n,
      price: 0.42,
      size: 10,
    });
    const orderTyped = buildType3OrderTypedData(order, POLYGON_CHAIN_ID, exchange, wallet);
    const orderInner = await account.signTypedData(orderTyped as never);
    const orderWire = assembleType3OrderSignature({ order, innerSignature: orderInner, chainId: POLYGON_CHAIN_ID, exchange });
    const orderDigest = hashTypedData(buildV2OrderTypedData(order, POLYGON_CHAIN_ID, exchange) as never);
    const orderResult = await isValidSignature(wallet, orderDigest, orderWire);
    console.log("order isValidSignature ->", orderResult);
    expect(orderResult).toBe(ERC1271_MAGIC);

    // --- ClobAuth (sigType 3) ---
    const auth: ClobAuthValue = {
      address: wallet,
      timestamp: "1700000000",
      nonce: 0n,
      message: "This message attests that I control the given wallet",
    };
    const authTyped = buildType3ClobAuthTypedData(auth, POLYGON_CHAIN_ID, wallet);
    const authInner = await account.signTypedData(authTyped as never);
    const authWire = assembleType3ClobAuthSignature({ auth, innerSignature: authInner, chainId: POLYGON_CHAIN_ID });
    const authDigest = hashTypedData(authTyped as never);
    // The CLOB passes the ClobAuth digest to isValidSignature; reconstruct it the same way.
    const { clobAuthDomainSeparator, clobAuthStructHash } = await import("./deposit-wallet.js");
    const { keccak256, concatHex } = await import("viem");
    const reconDigest = keccak256(
      concatHex(["0x1901", clobAuthDomainSeparator(POLYGON_CHAIN_ID), clobAuthStructHash(auth)]),
    );
    const authResult = await isValidSignature(wallet, reconDigest, authWire);
    console.log("clobauth isValidSignature ->", authResult, "(authDigest used by CLOB)", authDigest === reconDigest);
    expect(authResult).toBe(ERC1271_MAGIC);
  }, 180_000);
});
