import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  computeLimitAmounts,
  computeMarketAmounts,
  getOrderRawAmounts,
  getMarketOrderRawAmounts,
  ROUNDING_CONFIG,
  roundDown,
  roundUp,
  roundNormal,
  decimalPlaces,
  roundPriceToTick,
  isPriceOnTick,
  priceToMicro,
  microToPrice,
  buildV2LimitOrder,
  buildV2MarketOrder,
  buildV2OrderTypedData,
  buildV2OrderEnvelope,
  exchangeContractFor,
} from "./orders.js";
import { OrderSide, SignatureType, ZERO_BYTES32 } from "./eip712.js";
import { deriveTradingWallet } from "./wallet-setup.js";
import { POLYGON_CHAIN_ID, MATIC_CONTRACTS } from "./addresses.js";
import { recoverV2OrderSigner } from "./polymarket/index.js";

// Fixed (anvil #0) key so the round-trip + derived funder are regression-locked.
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const SIGNER = privateKeyToAccount(PK);
const FUNDER = deriveTradingWallet(SIGNER.address, "safe");

const SAMPLE_TOKEN_ID =
  71321045679252212594626385532706912750332728571942532289631379312455583992563n;

describe("float rounding helpers (clob-client parity)", () => {
  it("counts decimal places", () => {
    expect(decimalPlaces(100)).toBe(0);
    expect(decimalPlaces(0.137)).toBe(3);
  });
  it("rounds down / up / normal to N places", () => {
    expect(roundDown(33.339, 2)).toBe(33.33);
    expect(roundUp(33.331, 2)).toBe(33.34);
    expect(roundNormal(0.525, 2)).toBe(0.53);
    // already within precision → returned untouched
    expect(roundDown(100, 2)).toBe(100);
  });
});

describe("tick grid", () => {
  it("rounds a price onto its tick", () => {
    expect(roundPriceToTick(0.5237, "0.01")).toBe(0.52);
    expect(roundPriceToTick(0.13749, "0.001")).toBe(0.137);
  });
  it("validates on-grid prices", () => {
    expect(isPriceOnTick(0.52, "0.01")).toBe(true);
    expect(isPriceOnTick(0.523, "0.01")).toBe(false);
    expect(isPriceOnTick(0.137, "0.001")).toBe(true);
  });
});

describe("price <-> microdollar conversions", () => {
  it("round-trips price through microdollars", () => {
    expect(priceToMicro(0.52)).toBe(520_000n);
    expect(priceToMicro(1)).toBe(1_000_000n);
    expect(microToPrice(520_000n)).toBe(0.52);
  });
});

// Vectors captured from @polymarket/clob-client@4.22.8 getOrderRawAmounts /
// getMarketOrderRawAmounts → parseUnits(_, 6). Lock against accidental drift.
describe("limit order amounts (regression-locked vs clob-client)", () => {
  it("BUY 100 @ 0.52, tick 0.01", () => {
    expect(computeLimitAmounts(OrderSide.BUY, 100, 0.52, "0.01")).toEqual({
      makerAmount: 52_000_000n,
      takerAmount: 100_000_000n,
    });
  });
  it("SELL 100 @ 0.52, tick 0.01", () => {
    expect(computeLimitAmounts(OrderSide.SELL, 100, 0.52, "0.01")).toEqual({
      makerAmount: 100_000_000n,
      takerAmount: 52_000_000n,
    });
  });
  it("BUY 33.33 @ 0.137, tick 0.001 (non-trivial amount rounding)", () => {
    expect(computeLimitAmounts(OrderSide.BUY, 33.33, 0.137, "0.001")).toEqual({
      makerAmount: 4_566_210n,
      takerAmount: 33_330_000n,
    });
  });
  it("SELL 7.5 @ 0.6789, tick 0.0001", () => {
    expect(computeLimitAmounts(OrderSide.SELL, 7.5, 0.6789, "0.0001")).toEqual({
      makerAmount: 7_500_000n,
      takerAmount: 5_091_750n,
    });
  });
});

describe("market order amounts (regression-locked vs clob-client)", () => {
  it("BUY amount=50 @ 0.4, tick 0.01 (taker = amount/price)", () => {
    expect(computeMarketAmounts(OrderSide.BUY, 50, 0.4, "0.01")).toEqual({
      makerAmount: 50_000_000n,
      takerAmount: 125_000_000n,
    });
  });
  it("SELL shares=20 @ 0.4, tick 0.01 (taker = shares*price)", () => {
    expect(computeMarketAmounts(OrderSide.SELL, 20, 0.4, "0.01")).toEqual({
      makerAmount: 20_000_000n,
      takerAmount: 8_000_000n,
    });
  });
});

describe("raw-amount helpers expose the float legs", () => {
  it("limit BUY raw legs match the bundle", () => {
    expect(getOrderRawAmounts(OrderSide.BUY, 33.33, 0.137, ROUNDING_CONFIG["0.001"])).toEqual({
      rawMakerAmt: 4.56621,
      rawTakerAmt: 33.33,
    });
  });
  it("market BUY raw legs match the bundle", () => {
    expect(getMarketOrderRawAmounts(OrderSide.BUY, 50, 0.4, ROUNDING_CONFIG["0.01"])).toEqual({
      rawMakerAmt: 50,
      rawTakerAmt: 125,
    });
  });
});

describe("V2 order value assembly", () => {
  const base = {
    funder: FUNDER.address,
    signer: SIGNER.address,
    tokenId: SAMPLE_TOKEN_ID,
    side: OrderSide.BUY,
    signatureType: FUNDER.signatureType,
    salt: 123456789n,
    timestamp: 1_700_000_000n,
  } as const;

  it("maps maker=funder, signer=EOA, defaults metadata/builder to zero", () => {
    const o = buildV2LimitOrder({ ...base, price: 0.52, size: 100, tickSize: "0.01" });
    expect(o.maker).toBe(FUNDER.address);
    expect(o.signer).toBe(SIGNER.address);
    expect(o.signatureType).toBe(SignatureType.POLY_GNOSIS_SAFE);
    expect(o.makerAmount).toBe(52_000_000n);
    expect(o.takerAmount).toBe(100_000_000n);
    expect(o.metadata).toBe(ZERO_BYTES32);
    expect(o.builder).toBe(ZERO_BYTES32);
    expect(o.salt).toBe(123456789n);
    expect(o.timestamp).toBe(1_700_000_000n);
  });

  it("carries a non-zero builder code when supplied", () => {
    const builder = `0x${"ab".repeat(32)}` as const;
    const o = buildV2LimitOrder({ ...base, price: 0.52, size: 100, builder });
    expect(o.builder).toBe(builder);
  });

  it("market order uses amount/price legs", () => {
    const o = buildV2MarketOrder({ ...base, amount: 50, price: 0.4, tickSize: "0.01" });
    expect(o.makerAmount).toBe(50_000_000n);
    expect(o.takerAmount).toBe(125_000_000n);
  });
});

describe("V2 typed data + signature round-trip", () => {
  it("recovers the signer from a signed V2 order (the hard gate)", async () => {
    const order = buildV2LimitOrder({
      funder: FUNDER.address,
      signer: SIGNER.address,
      tokenId: SAMPLE_TOKEN_ID,
      side: OrderSide.BUY,
      signatureType: FUNDER.signatureType,
      salt: 999n,
      timestamp: 1_700_000_000n,
      price: 0.52,
      size: 100,
      tickSize: "0.01",
    });
    const verifyingContract = exchangeContractFor(POLYGON_CHAIN_ID, false);
    expect(verifyingContract).toBe(MATIC_CONTRACTS.exchangeV2);

    const typedData = buildV2OrderTypedData(order, POLYGON_CHAIN_ID, verifyingContract);
    // viem can't infer field types from the loosely-typed Order tuple; cast for the call.
    const signature = await SIGNER.signTypedData(
      typedData as unknown as Parameters<typeof SIGNER.signTypedData>[0],
    );

    const recovered = await recoverV2OrderSigner({ domain: typedData.domain, order, signature });
    expect(getAddress(recovered)).toBe(getAddress(SIGNER.address));
  });

  it("selects the negRisk V2 exchange when flagged", () => {
    expect(exchangeContractFor(POLYGON_CHAIN_ID, true)).toBe(MATIC_CONTRACTS.negRiskExchangeV2);
  });
});

describe("/order JSON envelope (orderToJsonV2)", () => {
  it("stringifies a signed order without mutating amounts", () => {
    const order = buildV2LimitOrder({
      funder: FUNDER.address,
      signer: SIGNER.address,
      tokenId: SAMPLE_TOKEN_ID,
      side: OrderSide.BUY,
      signatureType: FUNDER.signatureType,
      salt: 42n,
      timestamp: 1_700_000_000n,
      price: 0.52,
      size: 100,
    });
    const env = buildV2OrderEnvelope({
      order,
      signature: `0x${"00".repeat(65)}`,
      apiKey: "test-api-key",
      orderType: "GTC",
    });
    expect(env.order.makerAmount).toBe("52000000");
    expect(env.order.takerAmount).toBe("100000000");
    expect(env.order.taker).toBe("0x0000000000000000000000000000000000000000");
    expect(env.order.expiration).toBe("0");
    expect(env.owner).toBe("test-api-key");
    expect(env.orderType).toBe("GTC");
    expect(env.deferExec).toBe(false);
    expect(env.postOnly).toBe(false);
  });
});
