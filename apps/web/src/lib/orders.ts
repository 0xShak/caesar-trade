import { type Address, type Hex, type TypedDataDefinition } from "viem";
import {
  POLYGON_CHAIN_ID,
  OrderSide,
  SignatureType,
  buildV2LimitOrder,
  buildType3OrderTypedData,
  assembleType3OrderSignature,
  exchangeContractFor,
  generateOrderSalt,
} from "@caesar/chain";

/**
 * Browser-side trading helpers for the CLOB V2 **deposit-wallet** (signatureType
 * 3 / ERC-1271) path — the flow proven live in Phase 5/6 (see
 * docs/PHASE6-HANDOFF.md). Extracted from the original Portfolio dev harness so
 * the real market-page order ticket and any future caller share one signing +
 * submit implementation.
 *
 * The Privy embedded EOA (the deposit wallet's owner) signs everything; the
 * server only validates + injects CLOB creds and returns a prepared request that
 * the BROWSER POSTs directly to the CLOB (dodging the server's geoblocked IP).
 */

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Tick sizes the CLOB rounding config supports (clob-client ROUNDING_CONFIG). */
export type TickSizeStr = "0.1" | "0.01" | "0.001" | "0.0001";

const TICK_SIZES: readonly TickSizeStr[] = ["0.1", "0.01", "0.001", "0.0001"];

/**
 * Coerce a platform-market `tickSize` Float (e.g. 0.01, 0.001) into the discrete
 * string tick the order builder expects. Falls back to "0.01" for unknown/missing
 * values — the most common Polymarket tick.
 */
export function coerceTickSize(tick: number | null | undefined): TickSizeStr {
  if (tick == null || !Number.isFinite(tick) || tick <= 0) return "0.01";
  const match = TICK_SIZES.find((t) => Number(t) === tick);
  return match ?? "0.01";
}

export interface SignedOrderInput {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: "BUY" | "SELL";
  signatureType: number;
  timestamp: string;
  metadata: string;
  builder: string;
  expiration: string;
  signature: string;
  orderType: "GTC" | "FOK";
  negRisk: boolean;
}

export interface BuildSignedOrderArgs {
  /** the deposit wallet — maker == signer == funder for type-3. */
  depositWallet: Address;
  /** sign an EIP-712 payload with the embedded EOA (the wallet owner). */
  sign: (td: TypedDataDefinition) => Promise<Hex>;
  /** the outcome's clobTokenId (= `externalOutcomeId`). */
  tokenId: string;
  side: "BUY" | "SELL";
  /** limit price, 0..1. */
  price: number;
  /** size in shares. */
  size: number;
  orderType: "GTC" | "FOK";
  negRisk: boolean;
  tickSize: TickSizeStr;
}

/**
 * Build + browser-sign a type-3 (POLY_1271) V2 LIMIT order and return the input
 * object for the `preparePolymarketOrder` mutation. maker == signer == the deposit
 * wallet; the EOA signs the ERC-7739 nested EIP-712, and we assemble the on-chain
 * ERC-1271 signature the exchange validates.
 */
export async function buildSignedType3Order(
  args: BuildSignedOrderArgs,
): Promise<SignedOrderInput> {
  const { depositWallet, sign, tokenId, side, price, size, orderType, negRisk, tickSize } = args;

  const salt = generateOrderSalt(Math.random(), Date.now());
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const order = buildV2LimitOrder({
    funder: depositWallet,
    signer: depositWallet,
    tokenId: BigInt(tokenId),
    side: side === "BUY" ? OrderSide.BUY : OrderSide.SELL,
    signatureType: SignatureType.POLY_1271,
    salt,
    timestamp,
    price,
    size,
    tickSize,
  });
  const exchange = exchangeContractFor(POLYGON_CHAIN_ID, negRisk);
  const td = buildType3OrderTypedData(
    order,
    POLYGON_CHAIN_ID,
    exchange,
    depositWallet,
  ) as unknown as TypedDataDefinition;
  const innerSig = await sign(td);
  const signature = assembleType3OrderSignature({
    order,
    innerSignature: innerSig,
    chainId: POLYGON_CHAIN_ID,
    exchange,
  });

  return {
    salt: order.salt.toString(),
    maker: order.maker,
    signer: order.signer,
    taker: ZERO_ADDRESS,
    tokenId: order.tokenId.toString(),
    makerAmount: order.makerAmount.toString(),
    takerAmount: order.takerAmount.toString(),
    side,
    signatureType: order.signatureType,
    timestamp: order.timestamp.toString(),
    metadata: order.metadata,
    builder: order.builder,
    expiration: "0",
    signature,
    orderType,
    negRisk,
  };
}

export interface PreparedClobRequest {
  success: boolean;
  error?: string | null;
  url?: string | null;
  method?: string | null;
  headers?: Array<{ name: string; value: string }> | null;
  body?: string | null;
}

/**
 * Execute a server-prepared CLOB request directly from the browser (so the POST
 * comes from the user's IP, dodging the server's geoblock). Parses the CLOB
 * response into {id, status} or throws with the API error text.
 */
export async function sendPreparedToClob(
  p: PreparedClobRequest | null | undefined,
): Promise<{ id: string | null; status: string | null }> {
  if (!p?.success) throw new Error(p?.error ?? "request preparation failed");
  if (!p.url || !p.method) throw new Error("incomplete prepared request");
  const headers = Object.fromEntries((p.headers ?? []).map((h) => [h.name, h.value] as const));
  const resp = await fetch(p.url, { method: p.method, headers, body: p.body ?? undefined });
  const text = await resp.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  const b = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const errText =
    (b.error as string | undefined) ??
    (b.errorMsg as string | undefined) ??
    (typeof parsed === "string" && parsed ? parsed : undefined);
  if (!resp.ok || errText) throw new Error(errText ?? `CLOB HTTP ${resp.status}`);
  const id = (b.orderID ?? b.orderId ?? b.id ?? null) as string | null;
  const status = (b.status ?? (b.success === true ? "accepted" : null)) as string | null;
  return { id, status };
}

/** Truncate an error to a toast-friendly length. */
export function errMsg(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 140 ? m.slice(0, 140) + "…" : m;
}
