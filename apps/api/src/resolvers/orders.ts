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
  generateOrderSalt,
  microToPrice,
  OrderSide,
  DEFAULT_TICK_SIZE,
  type TickSize,
  type OrderV2Value,
} from "@caesar/chain";
import { type GraphQLContext } from "../auth.js";
import { resolveTradingWallet } from "../wallet.js";

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
