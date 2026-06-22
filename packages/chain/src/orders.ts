import { parseUnits, type Address } from "viem";
import {
  CTF_EXCHANGE_V2_ORDER,
  OrderSide,
  SignatureType,
  ZERO_BYTES32,
  orderDomain,
  type OrderV2Value,
} from "./eip712.js";
import { contractsForChain, type SupportedChainId } from "./addresses.js";

/**
 * Pure, offline CLOB **V2** order construction (dossier-trading-mechanics §1 /
 * dossier-onchain-signing §7). Nothing here touches the network or mainnet.
 *
 * The amount math is transcribed VERBATIM from `@polymarket/clob-client`
 * (v4.22.8, `order-builder/helpers.ts` + `utilities.ts`) so Caesar owns the
 * maker/taker derivation without pulling ethers into the viem world. We then
 * convert the float "raw" amounts into on-chain integer base units (6 decimals
 * for both collateral USDC/pUSD and the conditional ERC1155) as `bigint` — the
 * same scale as @caesar/money microdollars, so order amounts stay in the
 * money-discipline integer world.
 *
 * Signed V2 struct = maker(funder Safe) + signer(embedded EOA) + tokenId +
 * makerAmount/takerAmount + side + signatureType + timestamp + metadata +
 * builder. taker/expiration/feeRateBps are dropped from the SIGNED payload (they
 * travel only in the JSON envelope; fees are keyed off the builder code).
 */

// --- Decimals & tick rounding config (clob-client ROUNDING_CONFIG) ----------

/** Collateral + conditional-token on-chain decimals (clob-client config). */
export const COLLATERAL_TOKEN_DECIMALS = 6;

/** Polymarket tick sizes (price grid step). Default tick = "0.01" (1¢). */
export type TickSize = "0.1" | "0.01" | "0.001" | "0.0001";

export interface RoundConfig {
  /** decimals the price is rounded to */
  price: number;
  /** decimals the size is rounded to */
  size: number;
  /** decimals the derived amount is rounded to */
  amount: number;
}

/** tick -> {price,size,amount} decimal places (clob-client ROUNDING_CONFIG). */
export const ROUNDING_CONFIG: Record<TickSize, RoundConfig> = {
  "0.1": { price: 1, size: 2, amount: 3 },
  "0.01": { price: 2, size: 2, amount: 4 },
  "0.001": { price: 3, size: 2, amount: 5 },
  "0.0001": { price: 4, size: 2, amount: 6 },
};

export const DEFAULT_TICK_SIZE: TickSize = "0.01";

// --- Float rounding helpers (clob-client utilities.ts, VERBATIM) ------------

/** Count decimal places of a JS number (clob-client `decimalPlaces`). */
export function decimalPlaces(num: number): number {
  if (Number.isInteger(num)) return 0;
  const arr = num.toString().split(".");
  return arr[1]?.length ?? 0;
}

/** Round-half-up to `decimals` places (clob-client `roundNormal`). */
export function roundNormal(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num;
  return Math.round((num + Number.EPSILON) * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/** Round toward zero to `decimals` places (clob-client `roundDown`). */
export function roundDown(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num;
  return Math.floor(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/** Round away from zero to `decimals` places (clob-client `roundUp`). */
export function roundUp(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num;
  return Math.ceil(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// --- Price tick-grid helpers ------------------------------------------------

/** Round a price onto its tick grid (= clob-client `rawPrice = roundNormal`). */
export function roundPriceToTick(price: number, tickSize: TickSize = DEFAULT_TICK_SIZE): number {
  return roundNormal(price, ROUNDING_CONFIG[tickSize].price);
}

/** Is `price` already on the tick grid (within float tolerance)? */
export function isPriceOnTick(price: number, tickSize: TickSize = DEFAULT_TICK_SIZE): boolean {
  const step = Number(tickSize);
  const ratio = price / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

// --- price/size <-> microdollar conversions ---------------------------------
//
// A CLOB price is a probability in (0,1) priced in dollars; its microdollar form
// is price × 1e6 (0..1_000_000), matching @caesar/money's price scale. Size is
// a share count; its base-unit form is size × 1e6.

/** Probability/price (0..1) -> microdollar price (0..1_000_000n). */
export function priceToMicro(price: number): bigint {
  return parseUnits(price.toString(), COLLATERAL_TOKEN_DECIMALS);
}

/** Microdollar price (0..1_000_000n) -> probability/price number (0..1). */
export function microToPrice(priceMicro: bigint): number {
  return Number(priceMicro) / 1e6;
}

// --- Raw amount derivation (clob-client getOrderRawAmounts, VERBATIM) -------

export interface RawAmounts {
  /** maker leg, in human units (collateral for BUY, shares for SELL). */
  rawMakerAmt: number;
  /** taker leg, in human units (shares for BUY, collateral for SELL). */
  rawTakerAmt: number;
}

/**
 * LIMIT order maker/taker derivation (clob-client `getOrderRawAmounts`).
 * BUY:  taker = size (down), maker = size·price (collateral the maker pays).
 * SELL: maker = size (down), taker = size·price (collateral the maker receives).
 */
export function getOrderRawAmounts(
  side: OrderSide,
  size: number,
  price: number,
  cfg: RoundConfig,
): RawAmounts {
  const rawPrice = roundNormal(price, cfg.price);
  if (side === OrderSide.BUY) {
    const rawTakerAmt = roundDown(size, cfg.size);
    let rawMakerAmt = rawTakerAmt * rawPrice;
    if (decimalPlaces(rawMakerAmt) > cfg.amount) {
      rawMakerAmt = roundUp(rawMakerAmt, cfg.amount + 4);
      if (decimalPlaces(rawMakerAmt) > cfg.amount) rawMakerAmt = roundDown(rawMakerAmt, cfg.amount);
    }
    return { rawMakerAmt, rawTakerAmt };
  }
  const rawMakerAmt = roundDown(size, cfg.size);
  let rawTakerAmt = rawMakerAmt * rawPrice;
  if (decimalPlaces(rawTakerAmt) > cfg.amount) {
    rawTakerAmt = roundUp(rawTakerAmt, cfg.amount + 4);
    if (decimalPlaces(rawTakerAmt) > cfg.amount) rawTakerAmt = roundDown(rawTakerAmt, cfg.amount);
  }
  return { rawMakerAmt, rawTakerAmt };
}

/**
 * MARKET order maker/taker derivation (clob-client `getMarketOrderRawAmounts`).
 * Market BUY: `amount` is collateral spent; taker(shares) = amount / price.
 * Market SELL: `amount` is shares sold; taker(collateral) = amount · price.
 * Note price is rounded DOWN here (not roundNormal) — matches the bundle.
 */
export function getMarketOrderRawAmounts(
  side: OrderSide,
  amount: number,
  price: number,
  cfg: RoundConfig,
): RawAmounts {
  const rawPrice = roundDown(price, cfg.price);
  if (side === OrderSide.BUY) {
    const rawMakerAmt = roundDown(amount, cfg.size);
    let rawTakerAmt = rawMakerAmt / rawPrice;
    if (decimalPlaces(rawTakerAmt) > cfg.amount) {
      rawTakerAmt = roundUp(rawTakerAmt, cfg.amount + 4);
      if (decimalPlaces(rawTakerAmt) > cfg.amount) rawTakerAmt = roundDown(rawTakerAmt, cfg.amount);
    }
    return { rawMakerAmt, rawTakerAmt };
  }
  const rawMakerAmt = roundDown(amount, cfg.size);
  let rawTakerAmt = rawMakerAmt * rawPrice;
  if (decimalPlaces(rawTakerAmt) > cfg.amount) {
    rawTakerAmt = roundUp(rawTakerAmt, cfg.amount + 4);
    if (decimalPlaces(rawTakerAmt) > cfg.amount) rawTakerAmt = roundDown(rawTakerAmt, cfg.amount);
  }
  return { rawMakerAmt, rawTakerAmt };
}

/** Convert a float "raw" amount into integer base units (6 dp) as bigint. */
export function toBaseUnits(raw: number): bigint {
  return parseUnits(raw.toString(), COLLATERAL_TOKEN_DECIMALS);
}

export interface OrderAmounts {
  makerAmount: bigint;
  takerAmount: bigint;
}

/** LIMIT amounts in on-chain base units (bigint). */
export function computeLimitAmounts(
  side: OrderSide,
  size: number,
  price: number,
  tickSize: TickSize = DEFAULT_TICK_SIZE,
): OrderAmounts {
  const { rawMakerAmt, rawTakerAmt } = getOrderRawAmounts(side, size, price, ROUNDING_CONFIG[tickSize]);
  return { makerAmount: toBaseUnits(rawMakerAmt), takerAmount: toBaseUnits(rawTakerAmt) };
}

/** MARKET amounts in on-chain base units (bigint). */
export function computeMarketAmounts(
  side: OrderSide,
  amount: number,
  price: number,
  tickSize: TickSize = DEFAULT_TICK_SIZE,
): OrderAmounts {
  const { rawMakerAmt, rawTakerAmt } = getMarketOrderRawAmounts(
    side,
    amount,
    price,
    ROUNDING_CONFIG[tickSize],
  );
  return { makerAmount: toBaseUnits(rawMakerAmt), takerAmount: toBaseUnits(rawTakerAmt) };
}

// --- V2 order value assembly ------------------------------------------------

export interface BuildV2OrderParams {
  /** funder = the Gnosis Safe / proxy holding collateral (becomes `maker`). */
  funder: Address;
  /** the connected Privy embedded EOA that signs (becomes `signer`). */
  signer: Address;
  /** ERC1155 outcome-token id being traded. */
  tokenId: bigint;
  side: OrderSide;
  /** funder-kind-implied signature type (POLY_GNOSIS_SAFE for a Safe). */
  signatureType: SignatureType;
  /** unique salt — use generateOrderSalt(); pass a fixed value in tests. */
  salt: bigint;
  /** order creation time, unix SECONDS. */
  timestamp: bigint;
  /** bytes32 builder code; ZERO = no builder (default). */
  builder?: `0x${string}`;
  /** bytes32 metadata; ZERO default. */
  metadata?: `0x${string}`;
}

export interface BuildV2LimitOrderParams extends BuildV2OrderParams {
  /** limit price, probability 0..1. */
  price: number;
  /** order size in shares. */
  size: number;
  tickSize?: TickSize;
}

export interface BuildV2MarketOrderParams extends BuildV2OrderParams {
  /** BUY: collateral to spend; SELL: shares to sell. */
  amount: number;
  /** optimistic price (probability 0..1) used to derive the opposing leg. */
  price: number;
  tickSize?: TickSize;
}

function assembleV2Order(p: BuildV2OrderParams, amounts: OrderAmounts): OrderV2Value {
  return {
    salt: p.salt,
    maker: p.funder,
    signer: p.signer,
    tokenId: p.tokenId,
    makerAmount: amounts.makerAmount,
    takerAmount: amounts.takerAmount,
    side: p.side,
    signatureType: p.signatureType,
    timestamp: p.timestamp,
    metadata: p.metadata ?? ZERO_BYTES32,
    builder: p.builder ?? ZERO_BYTES32,
  };
}

/** Build a signed-struct-ready V2 LIMIT order value (maker=funder, signer=EOA). */
export function buildV2LimitOrder(params: BuildV2LimitOrderParams): OrderV2Value {
  const amounts = computeLimitAmounts(
    params.side,
    params.size,
    params.price,
    params.tickSize ?? DEFAULT_TICK_SIZE,
  );
  return assembleV2Order(params, amounts);
}

/** Build a signed-struct-ready V2 MARKET (FOK) order value. */
export function buildV2MarketOrder(params: BuildV2MarketOrderParams): OrderV2Value {
  const amounts = computeMarketAmounts(
    params.side,
    params.amount,
    params.price,
    params.tickSize ?? DEFAULT_TICK_SIZE,
  );
  return assembleV2Order(params, amounts);
}

// --- EIP-712 typed data + verifyingContract selection -----------------------

/** Pick the V2 exchange that verifies the signature (negRisk vs vanilla). */
export function exchangeContractFor(chainId: SupportedChainId, negRisk = false): Address {
  const c = contractsForChain(chainId);
  return negRisk ? c.negRiskExchangeV2 : c.exchangeV2;
}

/**
 * EIP-712 typed data for a V2 order — feed straight into a viem `signTypedData`,
 * and recover with `recoverV2OrderSigner` (packages/chain/src/polymarket). The
 * `verifyingContract` must be the V2 exchange the order routes through.
 */
export function buildV2OrderTypedData(
  order: OrderV2Value,
  chainId: SupportedChainId,
  verifyingContract: Address,
) {
  return {
    domain: orderDomain("2", chainId, verifyingContract),
    types: { Order: CTF_EXCHANGE_V2_ORDER as unknown as readonly { name: string; type: string }[] },
    primaryType: "Order" as const,
    message: order,
  };
}

// --- JSON envelope POSTed to /order (dossier §7.2) --------------------------

export type OrderExecutionType = "GTC" | "GTD" | "FOK";

export interface V2OrderEnvelope {
  deferExec: boolean;
  postOnly: boolean;
  order: {
    salt: number;
    maker: Address;
    signer: Address;
    taker: Address;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    side: OrderSide;
    signatureType: SignatureType;
    timestamp: string;
    expiration: string;
    metadata: `0x${string}`;
    builder: `0x${string}`;
    signature: `0x${string}`;
  };
  owner: string;
  orderType: OrderExecutionType;
}

export interface BuildEnvelopeParams {
  order: OrderV2Value;
  signature: `0x${string}`;
  /** CLOB api key (the `owner` field). */
  apiKey: string;
  orderType: OrderExecutionType;
  /** taker — zero address for a public order. */
  taker?: Address;
  /** GTD expiration unix seconds; "0" otherwise. */
  expiration?: bigint;
  postOnly?: boolean;
  deferExec?: boolean;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * Assemble the `/order` JSON envelope (`orderToJsonV2`). Pure string-ification
 * of a *signed* order — does NOT submit anything. The resolver only calls this
 * once mainnet trading is explicitly enabled.
 */
export function buildV2OrderEnvelope(p: BuildEnvelopeParams): V2OrderEnvelope {
  const o = p.order;
  return {
    deferExec: p.deferExec ?? false,
    postOnly: p.postOnly ?? false,
    order: {
      salt: Number(o.salt),
      maker: o.maker,
      signer: o.signer,
      taker: p.taker ?? ZERO_ADDRESS,
      tokenId: o.tokenId.toString(),
      makerAmount: o.makerAmount.toString(),
      takerAmount: o.takerAmount.toString(),
      side: o.side,
      signatureType: o.signatureType,
      timestamp: o.timestamp.toString(),
      expiration: (p.expiration ?? 0n).toString(),
      metadata: o.metadata,
      builder: o.builder,
      signature: p.signature,
    },
    owner: p.apiKey,
    orderType: p.orderType,
  };
}
