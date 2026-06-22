import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  getAddress,
  parseSignature,
  recoverTypedDataAddress,
  serializeSignature,
  size,
  toFunctionSelector,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCreateProxyTypedData,
  encodeCreateProxyCall,
  buildApprovalMultiSendTx,
  encodeMultiSendTransactions,
  assembleSafeTx,
  buildSafeTxTypedData,
  encodeExecTransaction,
  CREATE_PROXY_TYPE,
  SAFE_TX_TYPE,
  PROXY_FACTORY_DOMAIN_NAME,
} from "./safe-tx.js";
import { INFRA, POLYGON_CHAIN_ID, MATIC_CONTRACTS } from "./addresses.js";
import { requiredApprovals } from "./wallet-setup.js";

// Deterministic test signer (well-known anvil key #0); never used on mainnet.
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PK);

// Strict interface messages (SafeTxValue) lack the index signature viem's
// generics want; cast at the boundary (same pattern as orders.test.ts).
const sign = (td: unknown) =>
  account.signTypedData(td as Parameters<typeof account.signTypedData>[0]);
const recover = (p: unknown) =>
  recoverTypedDataAddress(p as Parameters<typeof recoverTypedDataAddress>[0]);

describe("CreateProxy (Safe deploy authorization)", () => {
  it("domain has the factory name, chainId, factory as verifyingContract, and NO version", () => {
    const { domain } = buildCreateProxyTypedData(POLYGON_CHAIN_ID);
    expect(domain.name).toBe(PROXY_FACTORY_DOMAIN_NAME);
    expect(domain.chainId).toBe(POLYGON_CHAIN_ID);
    expect(getAddress(domain.verifyingContract as string)).toBe(getAddress(INFRA.safeFactory));
    expect("version" in domain).toBe(false);
  });

  it("a signed CreateProxy recovers to the signer (Safe ends up owned by signer)", async () => {
    const td = buildCreateProxyTypedData(POLYGON_CHAIN_ID);
    const signature = await sign(td);
    const recovered = await recover({ ...td, signature });
    expect(getAddress(recovered)).toBe(getAddress(account.address));
  });

  it("encodeCreateProxyCall emits createProxy(...) with the split v/r/s of the signature", async () => {
    const td = buildCreateProxyTypedData(POLYGON_CHAIN_ID);
    const signature = await sign(td);
    const data = encodeCreateProxyCall(signature);

    const selector = toFunctionSelector(
      "createProxy(address,uint256,address,(uint8,bytes32,bytes32))",
    );
    expect(data.startsWith(selector)).toBe(true);

    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "createProxy",
          stateMutability: "nonpayable",
          inputs: [
            { name: "paymentToken", type: "address" },
            { name: "payment", type: "uint256" },
            { name: "paymentReceiver", type: "address" },
            {
              name: "createSig",
              type: "tuple",
              components: [
                { name: "v", type: "uint8" },
                { name: "r", type: "bytes32" },
                { name: "s", type: "bytes32" },
              ],
            },
          ],
          outputs: [],
        },
      ] as const,
      data,
    });
    const [paymentToken, payment, paymentReceiver, sig] = decoded.args as unknown as [
      string,
      bigint,
      string,
      { v: number; r: Hex; s: Hex },
    ];
    expect(BigInt(paymentToken)).toBe(0n);
    expect(payment).toBe(0n);
    expect(BigInt(paymentReceiver)).toBe(0n);

    // Re-serialize the decoded {v,r,s} and confirm it equals the original sig.
    const reserialized = serializeSignature({ r: sig.r, s: sig.s, v: BigInt(sig.v) });
    expect(reserialized.toLowerCase()).toBe(signature.toLowerCase());
  });
});

describe("approval MultiSend batch", () => {
  it("packs one leg per requiredApprovals entry, in order, as CALL (op=0)", () => {
    const approvals = requiredApprovals(POLYGON_CHAIN_ID, "v2");
    const packed = encodeMultiSendTransactions(
      approvals.map((a) => ({ to: a.token, value: 0n, data: a.data, operation: 0 as const })),
    );

    // Walk the packed blob: each leg = 1 + 20 + 32 + 32 + len bytes.
    let cursor = 2; // skip "0x"
    const hex = packed.slice(2);
    let legCount = 0;
    while (cursor - 2 < hex.length) {
      const op = hex.slice(cursor - 2, cursor - 2 + 2);
      expect(op).toBe("00"); // CALL
      const to = "0x" + hex.slice(cursor - 2 + 2, cursor - 2 + 2 + 40);
      const dataLenHex = hex.slice(cursor - 2 + 2 + 40 + 64, cursor - 2 + 2 + 40 + 64 + 64);
      const dataLen = Number(BigInt("0x" + dataLenHex));
      expect(getAddress(to)).toBe(getAddress(approvals[legCount]!.token));
      cursor += (1 + 20 + 32 + 32 + dataLen) * 2;
      legCount += 1;
    }
    expect(legCount).toBe(approvals.length);
    expect(legCount).toBe(4); // pUSD+CTF for exchangeV2 and negRiskExchangeV2
  });

  it("buildApprovalMultiSendTx targets MultiSend via DELEGATECALL (operation=1)", () => {
    const tx = buildApprovalMultiSendTx(POLYGON_CHAIN_ID, "v2");
    expect(getAddress(tx.to)).toBe(getAddress(INFRA.multiSend));
    expect(tx.operation).toBe(1);
    expect(tx.value).toBe(0n);
    expect(size(tx.data)).toBeGreaterThan(0);
  });
});

describe("SafeTx (execTransaction)", () => {
  it("domain is only { chainId, verifyingContract: safe } (Gnosis ≥1.3.0)", () => {
    const safe = "0x2697C609Cf85058c6e20daE0C469a825BB3E1bDB" as const;
    const tx = assembleSafeTx({ ...buildApprovalMultiSendTx(POLYGON_CHAIN_ID, "v2"), nonce: 0n });
    const { domain } = buildSafeTxTypedData(POLYGON_CHAIN_ID, safe, tx);
    expect(getAddress(domain.verifyingContract as string)).toBe(getAddress(safe));
    expect(domain.chainId).toBe(POLYGON_CHAIN_ID);
    expect("name" in domain).toBe(false);
    expect("version" in domain).toBe(false);
  });

  it("zero-gas defaults; nonce passes through", () => {
    const inner = buildApprovalMultiSendTx(POLYGON_CHAIN_ID, "v2");
    const tx = assembleSafeTx({ ...inner, nonce: 7n });
    expect(tx.safeTxGas).toBe(0n);
    expect(tx.baseGas).toBe(0n);
    expect(tx.gasPrice).toBe(0n);
    expect(BigInt(tx.gasToken)).toBe(0n);
    expect(BigInt(tx.refundReceiver)).toBe(0n);
    expect(tx.nonce).toBe(7n);
    expect(tx.operation).toBe(1);
  });

  it("a signed SafeTx recovers to the Safe owner", async () => {
    const safe = "0x2697C609Cf85058c6e20daE0C469a825BB3E1bDB" as const;
    const tx = assembleSafeTx({ ...buildApprovalMultiSendTx(POLYGON_CHAIN_ID, "v2"), nonce: 0n });
    const td = buildSafeTxTypedData(POLYGON_CHAIN_ID, safe, tx);
    const signature = await sign(td);
    const recovered = await recover({ ...td, signature });
    expect(getAddress(recovered)).toBe(getAddress(account.address));
  });

  it("encodeExecTransaction round-trips all fields + signature", async () => {
    const safe = "0x2697C609Cf85058c6e20daE0C469a825BB3E1bDB" as const;
    const tx = assembleSafeTx({ ...buildApprovalMultiSendTx(POLYGON_CHAIN_ID, "v2"), nonce: 0n });
    const td = buildSafeTxTypedData(POLYGON_CHAIN_ID, safe, tx);
    const signature = await sign(td);
    const data = encodeExecTransaction(tx, signature);

    const selector = toFunctionSelector(
      "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
    );
    expect(data.startsWith(selector)).toBe(true);

    const decoded = decodeFunctionData({
      abi: [
        {
          type: "function",
          name: "execTransaction",
          stateMutability: "payable",
          inputs: [
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "data", type: "bytes" },
            { name: "operation", type: "uint8" },
            { name: "safeTxGas", type: "uint256" },
            { name: "baseGas", type: "uint256" },
            { name: "gasPrice", type: "uint256" },
            { name: "gasToken", type: "address" },
            { name: "refundReceiver", type: "address" },
            { name: "signatures", type: "bytes" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const,
      data,
    });
    const args = decoded.args as unknown as [
      string, bigint, Hex, number, bigint, bigint, bigint, string, string, Hex,
    ];
    expect(getAddress(args[0])).toBe(getAddress(INFRA.multiSend));
    expect(args[3]).toBe(1); // delegatecall
    expect(args[9].toLowerCase()).toBe(signature.toLowerCase());
    // The signature is a standard 65-byte EIP-712 sig with v ∈ {27,28}.
    expect(size(args[9])).toBe(65);
    expect(Number(parseSignature(args[9]).v)).toBeGreaterThanOrEqual(27);
  });
});

// Sanity: the constant type tuples are the shapes we expect (guards refactors).
describe("type tuples", () => {
  it("CREATE_PROXY_TYPE + SAFE_TX_TYPE field counts", () => {
    expect(CREATE_PROXY_TYPE.map((f) => f.name)).toEqual([
      "paymentToken",
      "payment",
      "paymentReceiver",
    ]);
    expect(SAFE_TX_TYPE.length).toBe(10);
    expect(getAddress(MATIC_CONTRACTS.conditionalTokens)).toBeTruthy();
  });
});
