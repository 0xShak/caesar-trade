import { describe, expect, it } from "vitest";
import {
  concatHex,
  getAddress,
  hashStruct,
  hashTypedData,
  keccak256,
  recoverAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assembleType3ClobAuthSignature,
  assembleType3OrderSignature,
  buildType3ClobAuthTypedData,
  buildType3OrderTypedData,
  clobAuthDomainSeparator,
  clobAuthStructHash,
  deriveDepositWalletAddress,
  depositWalletId,
  exchangeV2DomainSeparator,
  orderStructHash,
  type ClobAuthValue,
} from "./deposit-wallet.js";
import { buildV2LimitOrder, buildV2OrderTypedData, exchangeContractFor } from "./orders.js";
import { OrderSide, SignatureType, clobAuthDomain } from "./eip712.js";
import { POLYGON_CHAIN_ID } from "./addresses.js";

const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ACCOUNT = privateKeyToAccount(PK);

const SAMPLE_TOKEN_ID =
  71321045679252212594626385532706912750332728571942532289631379312455583992563n;

describe("deposit-wallet CREATE2 derivation", () => {
  it("reproduces the SDK / on-chain vector", () => {
    // owner -> deposit wallet, verified against factory.predictWalletAddress + on-chain bytecode.
    expect(deriveDepositWalletAddress("0xA60601A4d903af91855C52BFB3814f6bA342f201")).toBe(
      getAddress("0x8b60BF0f650Bf7a0d93F10D72375b37De18F8c40"),
    );
  });

  it("ids an owner as bytes32(owner)", () => {
    expect(depositWalletId("0xA60601A4d903af91855C52BFB3814f6bA342f201")).toBe(
      "0x000000000000000000000000a60601a4d903af91855c52bfb3814f6ba342f201",
    );
  });

  it("is deterministic and address-checksummed", () => {
    const a = deriveDepositWalletAddress(ACCOUNT.address);
    expect(a).toBe(deriveDepositWalletAddress(ACCOUNT.address));
    expect(a).toBe(getAddress(a));
  });
});

describe("ERC-7739 type-3 order signing", () => {
  const exchange = exchangeContractFor(POLYGON_CHAIN_ID, false);
  const wallet = deriveDepositWalletAddress(ACCOUNT.address);
  const order = buildV2LimitOrder({
    funder: wallet, // maker = signer = deposit wallet (type 3)
    signer: wallet,
    tokenId: SAMPLE_TOKEN_ID,
    side: OrderSide.BUY,
    signatureType: SignatureType.POLY_1271,
    salt: 12345n,
    timestamp: 1_700_000_000n,
    price: 0.42,
    size: 10,
  });

  it("contents + app domain separator reproduce the exchange order digest (the on-chain gate)", () => {
    // The wallet's isValidSignature checks: keccak256(0x1901 ‖ APP_SEP ‖ contents) == hash,
    // where `hash` is the exchange's order digest. This must hold exactly.
    const appSep = exchangeV2DomainSeparator(POLYGON_CHAIN_ID, exchange);
    const contents = orderStructHash(order);
    const reconstructed = keccak256(concatHex(["0x1901", appSep, contents]));
    const orderDigest = hashTypedData(
      buildV2OrderTypedData(order, POLYGON_CHAIN_ID, exchange) as never,
    );
    expect(reconstructed).toBe(orderDigest);
  });

  it("inner TypedDataSign signature recovers the owner EOA", async () => {
    const typedData = buildType3OrderTypedData(order, POLYGON_CHAIN_ID, exchange, wallet);
    const innerSig = await ACCOUNT.signTypedData(typedData as never);
    const finalHash = hashTypedData(typedData as never);
    expect(await recoverAddress({ hash: finalHash, signature: innerSig })).toBe(ACCOUNT.address);
  });

  it("assembles the wire signature: inner ‖ appSep ‖ contents ‖ type ‖ len", async () => {
    const typedData = buildType3OrderTypedData(order, POLYGON_CHAIN_ID, exchange, wallet);
    const innerSig = await ACCOUNT.signTypedData(typedData as never);
    const wire = assembleType3OrderSignature({
      order,
      innerSignature: innerSig,
      chainId: POLYGON_CHAIN_ID,
      exchange,
    });
    const body = wire.slice(2);
    expect(body.startsWith(innerSig.slice(2))).toBe(true); // 65-byte ECDSA prefix
    // trailing uint16 length == byte length of the appended contentsType
    const declaredLen = parseInt(body.slice(-4), 16);
    const typeStart = (65 + 32 + 32) * 2; // after r‖s‖v ‖ appSep ‖ contents (body has no 0x)
    const typeHex = body.slice(typeStart, body.length - 4);
    expect(typeHex.length / 2).toBe(declaredLen);
    expect(Buffer.from(typeHex, "hex").toString()).toMatch(/^Order\(uint256 salt,address maker,/);
  });
});

describe("ERC-7739 type-3 ClobAuth signing", () => {
  const wallet = deriveDepositWalletAddress(ACCOUNT.address);
  const auth: ClobAuthValue = {
    address: wallet, // address = deposit wallet, NOT the EOA (the SDK-bug fix)
    timestamp: "1700000000",
    nonce: 0n,
    message: "This message attests that I control the given wallet",
  };

  it("contents + clobauth domain separator reproduce the ClobAuth digest", () => {
    const appSep = clobAuthDomainSeparator(POLYGON_CHAIN_ID);
    const contents = clobAuthStructHash(auth);
    const reconstructed = keccak256(concatHex(["0x1901", appSep, contents]));
    const clobDigest = hashTypedData({
      domain: clobAuthDomain(POLYGON_CHAIN_ID),
      types: {
        ClobAuth: [
          { name: "address", type: "address" },
          { name: "timestamp", type: "string" },
          { name: "nonce", type: "uint256" },
          { name: "message", type: "string" },
        ],
      },
      primaryType: "ClobAuth",
      message: auth as never,
    });
    expect(reconstructed).toBe(clobDigest);
  });

  it("inner signature recovers the owner EOA and assembles a wire sig", async () => {
    const typedData = buildType3ClobAuthTypedData(auth, POLYGON_CHAIN_ID, wallet);
    const innerSig = await ACCOUNT.signTypedData(typedData as never);
    expect(await recoverAddress({ hash: hashTypedData(typedData as never), signature: innerSig })).toBe(
      ACCOUNT.address,
    );
    const wire = assembleType3ClobAuthSignature({
      auth,
      innerSignature: innerSig,
      chainId: POLYGON_CHAIN_ID,
    });
    expect((wire as Hex).startsWith(innerSig)).toBe(true);
    expect(Buffer.from(wire.slice(-4 - 1, -4), "hex")).toBeTruthy();
  });

  it("hashStruct uses the same ClobAuth typehash as a standalone hash", () => {
    const direct = hashStruct({
      data: auth as never,
      types: {
        ClobAuth: [
          { name: "address", type: "address" },
          { name: "timestamp", type: "string" },
          { name: "nonce", type: "uint256" },
          { name: "message", type: "string" },
        ],
      },
      primaryType: "ClobAuth",
    });
    expect(clobAuthStructHash(auth)).toBe(direct);
  });
});
