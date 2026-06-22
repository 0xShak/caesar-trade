/**
 * Phase 3 trading mutations — placeOrder / placeSplitOrder / placeMergeOrder /
 * placeOrderBatch / cancelOrder / cancelMarketOrders.
 *
 * SAFETY (docs/MAINNET-GATES.md §15): live execution is mainnet-only and there
 * is no Amoy CLOB to exercise against. EVERY network/live call is gated behind
 * `CAESAR_ENABLE_MAINNET_TRADING` (default OFF). When off — the default — these
 * resolvers VALIDATE the request and CONSTRUCT the (unsigned) V2 order off the
 * pure `@caesar/chain` builders, then return a `GATED_DRY_RUN` placement. They
 * never sign, never POST to the CLOB, never touch a real wallet.
 *
 * The order math/struct/typed-data all live in `@caesar/chain` (orders.ts,
 * unit-tested with regression vectors). This module is only the GraphQL plumbing
 * + the mainnet gate.
 */
import {
  buildV2LimitOrder,
  buildV2MarketOrder,
  buildV2OrderEnvelope,
  exchangeContractFor,
  orderDomain,
  generateOrderSalt,
  microToPrice,
  OrderSide,
  SignatureType,
  POLYGON_CHAIN_ID,
  DEFAULT_TICK_SIZE,
  buildType3OrderTypedData,
  type TickSize,
  type OrderV2Value,
  type OrderExecutionType,
} from "@caesar/chain";
import { recoverV2OrderSigner } from "@caesar/chain/polymarket";
import { hashTypedData, recoverAddress, type Address, type Hex } from "viem";
import { type GraphQLContext } from "../auth.js";
import { resolveTradingWallet } from "../wallet.js";
import { loadCredentials } from "../credentials.js";
import {
  postOrder,
  cancelOrder as clobCancelOrder,
  prepareOrderRequest,
  prepareCancelRequest,
  type ApiCreds,
} from "../clob.js";

/** Mainnet trading hard gate — OFF unless explicitly enabled in the env. */
export const MAINNET_TRADING_ENABLED = process.env.CAESAR_ENABLE_MAINNET_TRADING === "true";

/** Status returned for every constructed-but-unsubmitted order while gated. */
const GATED_STATUS = "GATED_DRY_RUN";
const GATED_REASON =
  "mainnet trading disabled (set CAESAR_ENABLE_MAINNET_TRADING=true to enable; live execution is mainnet-only)";

// --- SDL input shapes (the slices we consume) -------------------------------

type SdlOrderSide = "BUY" | "SELL";
type SdlExecType = "GTC" | "GTD" | "FOK";

interface LimitOrderInput {
  side: SdlOrderSide;
  externalOutcomeId: string;
  price: number;
  size: number;
  orderExecutionType: SdlExecType;
  expirationSec?: number | null;
}
interface MarketBuyInput {
  externalOutcomeId: string;
  amount: number;
  price?: number | null;
  orderExecutionType?: SdlExecType | null;
}
interface MarketSellInput {
  externalOutcomeId: string;
  shares: number;
  price?: number | null;
  orderExecutionType?: SdlExecType | null;
}
interface SplitOrderInput {
  amountMicrodollars: string;
}
interface MergeOrderInput {
  amountMicrodollars?: string | null;
}
interface OrderActionInput {
  marketBuy?: MarketBuyInput | null;
  marketSell?: MarketSellInput | null;
  limit?: LimitOrderInput | null;
  split?: SplitOrderInput | null;
  merge?: MergeOrderInput | null;
  convert?: unknown;
}
export interface PlaceOrderInput {
  platform: "polymarket" | "kalshi";
  externalMarketId: string;
  tradingAccountId: string;
  order: OrderActionInput;
}
export interface PlaceOrderBatchInput {
  orders: PlaceOrderInput[];
}
export interface CancelOrderInput {
  platform: "polymarket" | "kalshi";
  externalMarketId: string;
  platformOrderId: string;
}
export interface CancelMarketOrdersInput {
  platform: "polymarket" | "kalshi";
  externalMarketId: string;
}

// --- helpers ----------------------------------------------------------------

function toOrderSide(side: SdlOrderSide): OrderSide {
  return side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
}

function whichAction(o: OrderActionInput): keyof OrderActionInput | null {
  for (const k of ["marketBuy", "marketSell", "limit", "split", "merge", "convert"] as const) {
    if (o[k] != null) return k;
  }
  return null;
}

/** Salt + timestamp for a fresh order (non-deterministic — runtime only). */
function freshSaltAndTs(): { salt: bigint; timestamp: bigint } {
  const now = Date.now();
  return { salt: generateOrderSalt(Math.random(), now), timestamp: BigInt(Math.floor(now / 1000)) };
}

export interface BuiltPlacement {
  __typename: string;
  platform: string;
  externalMarketId: string;
  externalOutcomeId: string | null;
  status: string;
  platformStatus: string;
  platformOrderId: string | null;
  estimatedPrice: number | null;
  estimatedAmount: number | null;
  avgFillPrice: number | null;
  filledAmount: number | null;
  filledSize: number | null;
  order: null;
}

function gatedPlacement(
  typename: string,
  input: PlaceOrderInput,
  externalOutcomeId: string | null,
  estimatedPrice: number | null,
  estimatedAmount: number | null,
): BuiltPlacement {
  return {
    __typename: typename,
    platform: input.platform,
    externalMarketId: input.externalMarketId,
    externalOutcomeId,
    status: GATED_STATUS,
    platformStatus: GATED_REASON,
    platformOrderId: null,
    estimatedPrice,
    estimatedAmount,
    avgFillPrice: null,
    filledAmount: null,
    filledSize: null,
    order: null,
  };
}

class TradingError extends Error {}

/**
 * The single place a live order would leave the process. Defense-in-depth: it
 * throws unless the mainnet gate is explicitly on, so even a future caller that
 * forgets the dry-run short-circuit cannot submit by accident. Not yet wired to
 * a server signer — live execution stays unbuilt until the §15 gates clear.
 */
function submitToClob(_order: OrderV2Value): never {
  if (!MAINNET_TRADING_ENABLED) {
    throw new TradingError(GATED_REASON);
  }
  throw new TradingError(
    "live CLOB submission is not wired to a server signer yet — mainnet execution intentionally unbuilt",
  );
}

// --- placeOrder + variants --------------------------------------------------

/**
 * Construct + validate a single order. Returns a gated dry-run placement (and
 * builds the unsigned V2 order to prove the math holds) while mainnet trading is
 * disabled; throws TradingError for unsupported/invalid requests.
 */
async function buildPlacement(
  ctx: GraphQLContext,
  input: PlaceOrderInput,
  restrictTo?: "split" | "merge",
): Promise<BuiltPlacement> {
  if (input.platform !== "polymarket") {
    throw new TradingError(`trading not supported for platform "${input.platform}" (Polymarket only)`);
  }
  const action = whichAction(input.order);
  if (!action) throw new TradingError("order action is empty — set exactly one of the oneof fields");
  if (restrictTo && action !== restrictTo) {
    throw new TradingError(`this mutation expects order.${restrictTo}, got order.${action}`);
  }

  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) throw new TradingError("no trading wallet — sign in and provision an embedded wallet first");

  const { salt, timestamp } = freshSaltAndTs();
  const tickSize: TickSize = DEFAULT_TICK_SIZE;

  if (action === "limit") {
    const o = input.order.limit!;
    const side = toOrderSide(o.side);
    // Build (validates amounts compute) but DO NOT sign/submit while gated.
    const order = buildV2LimitOrder({
      funder: wallet.funder,
      signer: wallet.signer,
      tokenId: BigInt(o.externalOutcomeId),
      side,
      signatureType: wallet.signatureType,
      salt,
      timestamp,
      price: o.price,
      size: o.size,
      tickSize,
    });
    const notional = microToPrice(computeNotional(order));
    if (!MAINNET_TRADING_ENABLED)
      return gatedPlacement("LimitOrderPlacement", input, o.externalOutcomeId, o.price, notional);
    submitToClob(order);
  }

  if (action === "marketBuy" || action === "marketSell") {
    const isBuy = action === "marketBuy";
    const mo = (isBuy ? input.order.marketBuy : input.order.marketSell)!;
    const amount = isBuy ? (mo as MarketBuyInput).amount : (mo as MarketSellInput).shares;
    const price = mo.price ?? 1; // optimistic price snapshot; FOK at-or-better
    const order = buildV2MarketOrder({
      funder: wallet.funder,
      signer: wallet.signer,
      tokenId: BigInt(mo.externalOutcomeId),
      side: isBuy ? OrderSide.BUY : OrderSide.SELL,
      signatureType: wallet.signatureType,
      salt,
      timestamp,
      amount,
      price,
      tickSize,
    });
    const notional = microToPrice(computeNotional(order));
    if (!MAINNET_TRADING_ENABLED)
      return gatedPlacement("MarketOrderPlacement", input, mo.externalOutcomeId, price, notional);
    submitToClob(order);
  }

  if (action === "split" || action === "merge") {
    // On-chain neg-risk primitives (return a tx hash when live). No CLOB order;
    // gated dry-run echoes the requested amount.
    const raw =
      action === "split"
        ? input.order.split!.amountMicrodollars
        : input.order.merge?.amountMicrodollars;
    const amountDollars = raw != null ? microToPrice(BigInt(raw)) : null;
    if (!MAINNET_TRADING_ENABLED) {
      const typename = action === "split" ? "SplitOrderPlacement" : "MergeOrderPlacement";
      return gatedPlacement(typename, input, null, null, amountDollars);
    }
    throw new TradingError(`${action} execution is mainnet-only and not yet wired`);
  }

  throw new TradingError(`unsupported order action: ${action}`);
}

/** notional in microdollars = the collateral leg of the order (maker for BUY). */
function computeNotional(order: OrderV2Value): bigint {
  // BUY: maker leg is collateral; SELL: taker leg is collateral.
  return order.side === OrderSide.BUY ? order.makerAmount : order.takerAmount;
}

export async function resolvePlaceOrder(ctx: GraphQLContext, input: PlaceOrderInput) {
  if (!ctx.auth) return null;
  return buildPlacement(ctx, input);
}

export async function resolvePlaceSplitOrder(ctx: GraphQLContext, input: PlaceOrderInput) {
  if (!ctx.auth) return null;
  return buildPlacement(ctx, input, "split");
}

export async function resolvePlaceMergeOrder(ctx: GraphQLContext, input: PlaceOrderInput) {
  if (!ctx.auth) return null;
  return buildPlacement(ctx, input, "merge");
}

// --- placeOrderBatch --------------------------------------------------------

export async function resolvePlaceOrderBatch(ctx: GraphQLContext, input: PlaceOrderBatchInput) {
  if (!ctx.auth) return null;
  const results = [];
  for (const order of input.orders) {
    try {
      const p = await buildPlacement(ctx, order);
      results.push({
        success: true,
        error: null,
        orderId: null,
        status: p.status,
        platformOrderId: p.platformOrderId,
        estimatedPrice: p.estimatedPrice,
        estimatedAmount: p.estimatedAmount,
        platformStatus: p.platformStatus,
        avgFillPrice: p.avgFillPrice,
        filledAmount: p.filledAmount,
        filledSize: p.filledSize,
        order: null,
      });
    } catch (err) {
      results.push({
        success: false,
        error: err instanceof Error ? err.message : String(err),
        orderId: null,
        status: "REJECTED",
        platformOrderId: null,
        estimatedPrice: null,
        estimatedAmount: null,
        platformStatus: null,
        avgFillPrice: null,
        filledAmount: null,
        filledSize: null,
        order: null,
      });
    }
  }
  return { results };
}

// --- cancelOrder / cancelMarketOrders ---------------------------------------

export async function resolveCancelOrder(ctx: GraphQLContext, input: CancelOrderInput) {
  if (!ctx.auth) return null;
  if (input.platform !== "polymarket") {
    return { orderId: null, status: "REJECTED", platformOrderId: input.platformOrderId };
  }
  // Cancellation is a live CLOB call — gated. Echo the id with the gated status.
  return {
    orderId: null,
    status: GATED_STATUS,
    platformOrderId: input.platformOrderId,
  };
}

export async function resolveCancelMarketOrders(ctx: GraphQLContext, input: CancelMarketOrdersInput) {
  if (!ctx.auth) return null;
  if (input.platform !== "polymarket") {
    return {
      canceledPlatformOrderIds: [],
      failures: [{ platformOrderId: null, reason: `unsupported platform "${input.platform}"` }],
    };
  }
  // Live CLOB call — gated. Nothing canceled; report the gate as a failure note.
  return {
    canceledPlatformOrderIds: [],
    failures: [{ platformOrderId: null, reason: GATED_REASON }],
  };
}

// --- Browser-signed order submission (Phase 3 live path) --------------------
//
// The browser builds the V2 order via @caesar/chain, signs the EIP-712 typed
// data with the Privy embedded wallet, and sends the full struct + signature
// here. The server re-derives nothing about the trade: it VALIDATES (maker is
// the user's Safe, signer is the user's EOA, and the signature recovers to that
// EOA), then injects the user's stored CLOB api key as `owner` and POSTs with
// an L2 HMAC. Hard-gated behind CAESAR_ENABLE_MAINNET_TRADING.

/** Wire shape the browser sends — bigints as decimal strings, bytes32 as hex. */
export interface SignedPolymarketOrderInput {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: SdlOrderSide;
  signatureType: number;
  timestamp: string;
  metadata: string;
  builder: string;
  /** GTD expiration unix seconds, "0" otherwise (envelope field, unsigned). */
  expiration: string;
  signature: string;
  orderType: SdlExecType;
  /** Which V2 exchange the order was signed against (verifyingContract). */
  negRisk: boolean;
}

export interface SubmitOrderResult {
  success: boolean;
  status: string | null;
  platformOrderId: string | null;
  error: string | null;
}

function reconstructOrder(input: SignedPolymarketOrderInput): OrderV2Value {
  return {
    salt: BigInt(input.salt),
    maker: input.maker as Address,
    signer: input.signer as Address,
    tokenId: BigInt(input.tokenId),
    makerAmount: BigInt(input.makerAmount),
    takerAmount: BigInt(input.takerAmount),
    side: input.side === "BUY" ? OrderSide.BUY : OrderSide.SELL,
    signatureType: input.signatureType as SignatureType,
    timestamp: BigInt(input.timestamp),
    metadata: input.metadata as `0x${string}`,
    builder: input.builder as `0x${string}`,
  };
}

/** Extract the CLOB order id + status from the (loosely-typed) /order response. */
function readOrderResponse(body: unknown): { id: string | null; status: string | null; error: string | null } {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const id = (b.orderID ?? b.orderId ?? b.id) as string | undefined;
    const status = (b.status ?? (b.success === true ? "accepted" : undefined)) as string | undefined;
    const error = (b.error ?? b.errorMsg ?? b.message) as string | undefined;
    return { id: id ?? null, status: status ?? null, error: error ?? null };
  }
  return { id: null, status: null, error: typeof body === "string" ? body : null };
}

/**
 * Shared gate + ownership + signature validation, returning the ready-to-send
 * envelope (and the user's signer + creds) or a typed error. Used by both the
 * server-side submit and the browser-submit `prepare` path.
 */
type ValidatedOrder =
  | { ok: true; signer: Address; creds: ApiCreds; envelope: ReturnType<typeof buildV2OrderEnvelope> }
  | { ok: false; error: string };

async function validateOrderForSubmission(
  ctx: GraphQLContext,
  input: SignedPolymarketOrderInput,
): Promise<ValidatedOrder> {
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return { ok: false, error: "no trading wallet — sign in first" };

  const order = reconstructOrder(input);
  const verifyingContract = exchangeContractFor(POLYGON_CHAIN_ID, input.negRisk);
  const isType3 = input.signatureType === SignatureType.POLY_1271;

  // Ownership + signature checks differ by signature type. The user can only hurt
  // themselves, but we refuse to forward a struct that doesn't match their wallet
  // or whose signature doesn't recover to their EOA.
  if (isType3) {
    // CLOB V2 deposit wallet: maker == signer == the deposit wallet; the EOA owns
    // it and produced an ERC-7739-wrapped ERC-1271 signature. Verify the inner
    // 65-byte ECDSA recovers to the EOA over the TypedDataSign digest.
    if (input.maker.toLowerCase() !== wallet.depositWallet.toLowerCase()) {
      return { ok: false, error: "order maker is not your deposit wallet" };
    }
    if (input.signer.toLowerCase() !== wallet.depositWallet.toLowerCase()) {
      return { ok: false, error: "order signer is not your deposit wallet" };
    }
    try {
      const typedData = buildType3OrderTypedData(
        order,
        POLYGON_CHAIN_ID,
        verifyingContract,
        wallet.depositWallet,
      );
      const finalHash = hashTypedData(typedData as never);
      const innerSig = `0x${input.signature.replace(/^0x/, "").slice(0, 130)}` as Hex; // r‖s‖v
      const recovered = await recoverAddress({ hash: finalHash, signature: innerSig });
      if (recovered.toLowerCase() !== wallet.signer.toLowerCase()) {
        return { ok: false, error: "signature does not match your wallet" };
      }
    } catch (err) {
      return { ok: false, error: `signature verification failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else {
    // Legacy Safe (type 2): maker == Safe, signer == EOA, direct EIP-712 recovery.
    if (input.maker.toLowerCase() !== wallet.funder.toLowerCase()) {
      return { ok: false, error: "order maker is not your Safe" };
    }
    if (input.signer.toLowerCase() !== wallet.signer.toLowerCase()) {
      return { ok: false, error: "order signer is not your wallet" };
    }
    try {
      const recovered = await recoverV2OrderSigner({
        domain: orderDomain("2", POLYGON_CHAIN_ID, verifyingContract),
        order,
        signature: input.signature as `0x${string}`,
      });
      if (recovered.toLowerCase() !== wallet.signer.toLowerCase()) {
        return { ok: false, error: "signature does not match your wallet" };
      }
    } catch (err) {
      return { ok: false, error: `signature verification failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const creds = (await loadCredentials(ctx.auth!.userId))?.creds;
  if (!creds) return { ok: false, error: "no CLOB credentials — derive API credentials first" };

  const envelope = buildV2OrderEnvelope({
    order,
    signature: input.signature as `0x${string}`,
    apiKey: creds.key,
    orderType: input.orderType as OrderExecutionType,
    taker: input.taker as Address,
    expiration: BigInt(input.expiration),
  });
  return { ok: true, signer: wallet.signer, creds, envelope };
}

/**
 * Server-side submit. Works only from an allowed-region, non-datacenter host —
 * Polymarket geoblocks the server's IP otherwise. For the multi-tenant product,
 * prefer `resolvePreparePolymarketOrder` (browser submits from the user's IP).
 */
export async function resolveSubmitPolymarketOrder(
  ctx: GraphQLContext,
  input: SignedPolymarketOrderInput,
): Promise<SubmitOrderResult | null> {
  if (!ctx.auth) return null;
  if (!MAINNET_TRADING_ENABLED) {
    return { success: false, status: GATED_STATUS, platformOrderId: null, error: GATED_REASON };
  }
  const v = await validateOrderForSubmission(ctx, input);
  if (!v.ok) return { success: false, status: null, platformOrderId: null, error: v.error };

  try {
    const res = await postOrder(v.signer, v.creds, v.envelope);
    const { id, status, error } = readOrderResponse(res.body);
    if (!res.ok || error) {
      return { success: false, status, platformOrderId: id, error: error ?? `CLOB HTTP ${res.status}` };
    }
    return { success: true, status: status ?? "accepted", platformOrderId: id, error: null };
  } catch (err) {
    return {
      success: false,
      status: null,
      platformOrderId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** GraphQL-friendly header pair (no map type in SDL). */
export interface HttpHeaderKV {
  name: string;
  value: string;
}

export interface PreparedClobRequestResult {
  success: boolean;
  error: string | null;
  url: string | null;
  method: string | null;
  headers: HttpHeaderKV[] | null;
  body: string | null;
}

function headersToKV(headers: Record<string, string>): HttpHeaderKV[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

const PREPARE_GATED: PreparedClobRequestResult = {
  success: false,
  error: GATED_REASON,
  url: null,
  method: null,
  headers: null,
  body: null,
};

/**
 * Validate + authenticate an order and return the request for the BROWSER to
 * send itself (POST from the user's IP). The server computes the L2 HMAC over
 * the exact body+timestamp; the browser must fetch promptly (the timestamp is
 * embedded in the signature).
 */
export async function resolvePreparePolymarketOrder(
  ctx: GraphQLContext,
  input: SignedPolymarketOrderInput,
): Promise<PreparedClobRequestResult | null> {
  if (!ctx.auth) return null;
  if (!MAINNET_TRADING_ENABLED) return PREPARE_GATED;
  const v = await validateOrderForSubmission(ctx, input);
  if (!v.ok) return { ...PREPARE_GATED, error: v.error };
  const req = prepareOrderRequest(v.signer, v.creds, v.envelope);
  return { success: true, error: null, url: req.url, method: req.method, headers: headersToKV(req.headers), body: req.body };
}

/** Prepare the browser-sent DELETE /order cancel request. */
export async function resolvePreparePolymarketCancel(
  ctx: GraphQLContext,
  orderId: string,
): Promise<PreparedClobRequestResult | null> {
  if (!ctx.auth) return null;
  if (!MAINNET_TRADING_ENABLED) return PREPARE_GATED;
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) return { ...PREPARE_GATED, error: "no trading wallet — sign in first" };
  const creds = (await loadCredentials(ctx.auth.userId))?.creds;
  if (!creds) return { ...PREPARE_GATED, error: "no CLOB credentials" };
  const req = prepareCancelRequest(wallet.signer, creds, orderId);
  return { success: true, error: null, url: req.url, method: req.method, headers: headersToKV(req.headers), body: req.body };
}

export async function resolveCancelPolymarketOrder(
  ctx: GraphQLContext,
  orderId: string,
): Promise<SubmitOrderResult | null> {
  if (!ctx.auth) return null;
  if (!MAINNET_TRADING_ENABLED) {
    return { success: false, status: GATED_STATUS, platformOrderId: orderId, error: GATED_REASON };
  }
  const wallet = await resolveTradingWallet(ctx);
  if (!wallet) {
    return { success: false, status: null, platformOrderId: orderId, error: "no trading wallet — sign in first" };
  }
  const creds = (await loadCredentials(ctx.auth.userId))?.creds;
  if (!creds) {
    return { success: false, status: null, platformOrderId: orderId, error: "no CLOB credentials" };
  }
  try {
    const res = await clobCancelOrder(wallet.signer, creds, orderId);
    const { error } = readOrderResponse(res.body);
    if (!res.ok || error) {
      return { success: false, status: null, platformOrderId: orderId, error: error ?? `CLOB HTTP ${res.status}` };
    }
    return { success: true, status: "canceled", platformOrderId: orderId, error: null };
  } catch (err) {
    return {
      success: false,
      status: null,
      platformOrderId: orderId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
