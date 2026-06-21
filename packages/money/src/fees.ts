import Decimal from "decimal.js";
import { BPS_DENOMINATOR, microToDollars, type Microdollars } from "./money.js";

/**
 * Polymarket fee math (bible §7).
 *
 *   base          = 0.08 (8%)
 *   effectiveRate = base · (1 − price)        // decreases toward price 1.0
 *   builder       = +100 bps when the `clob-v2-with-builder` flag is on (Polymarket only)
 *   feeRateBps    = ceil( (effectiveRate + builder) · 1e4 )
 *   requiredBalance grossed up via cost · (1e4 + bps) / 1e4
 *
 * NOTE(verify): the bible also mentions a "YES +100 / NO +50 add-on". The exact
 * outcome-side semantics must be confirmed against dossier-trading-mechanics.md
 * before mainnet (Phase 3). This module implements the confirmed core only.
 */
export const BASE_FEE_RATE = new Decimal("0.08");
export const BUILDER_FEE_BPS = 100n; // 1.00%

export interface FeeOpts {
  /** clob-v2-with-builder flag, Polymarket only. */
  builder?: boolean;
}

/** Effective fee rate as a Decimal, given price (0..1 probability). */
export function effectiveFeeRate(price: Decimal | number | string): Decimal {
  const p = new Decimal(price as Decimal.Value);
  return BASE_FEE_RATE.times(new Decimal(1).minus(p));
}

/** Integer fee rate in bps: ceil((effectiveRate + builder) × 1e4). */
export function feeRateBps(price: Decimal | number | string, opts: FeeOpts = {}): bigint {
  const rate = effectiveFeeRate(price);
  const bps = rate.times(10_000).plus(opts.builder ? BUILDER_FEE_BPS.toString() : 0);
  return BigInt(bps.ceil().toFixed(0));
}

/** Gross up a microdollar cost to cover the fee: cost · (1e4 + bps) / 1e4. */
export function grossUpRequiredBalance(costMicro: Microdollars, bps: bigint): Microdollars {
  return (costMicro * (BPS_DENOMINATOR + bps)) / BPS_DENOMINATOR;
}

/** Unrealized PnL in microdollars: (currentPrice − avgEntry) × size, all in micro. */
export function unrealizedPnlMicro(
  currentPriceMicro: Microdollars,
  avgEntryMicro: Microdollars,
  size: Decimal | number | string,
): Microdollars {
  const delta = microToDollars(currentPriceMicro).minus(microToDollars(avgEntryMicro));
  const sz = new Decimal(size as Decimal.Value);
  return BigInt(delta.times(sz).times(1_000_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}
