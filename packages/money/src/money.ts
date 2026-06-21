import Decimal from "decimal.js";

/**
 * Caesar money discipline (bible §1, §7, §12).
 *
 * Canonical wire/storage unit = **microdollars**: integer USD × 1e6, held as
 * `bigint` so there is no float drift when summing fees / PnL across thousands
 * of rows. `decimal.js` is used only for the multiplication step (price × size,
 * fee rates) and the result is rounded back into integer microdollars.
 *
 *   $1.00      = 1_000_000n micro
 *   1 cent     =    10_000n micro      (Polymarket 0..1 $, Kalshi 1..99 ¢ both normalize here)
 *   price 0..1 = 0 .. 1_000_000n micro (probability = price / 1e6)
 */
export type Microdollars = bigint;

export const MICRO_PER_DOLLAR = 1_000_000n;
export const MICRO_PER_CENT = 10_000n;
export const BPS_DENOMINATOR = 10_000n;

// Deterministic, high-precision Decimal config (no surprise rounding mode).
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

type Num = number | string | Decimal;

function roundToBigInt(d: Decimal): Microdollars {
  return BigInt(d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

// --- conversions ------------------------------------------------------------

/** Dollars → microdollars (round half-up to nearest integer micro). */
export function dollarsToMicro(dollars: Num): Microdollars {
  return roundToBigInt(new Decimal(dollars as Decimal.Value).times(1_000_000));
}

/** Microdollars → dollars (exact Decimal). */
export function microToDollars(micro: Microdollars): Decimal {
  return new Decimal(micro.toString()).div(1_000_000);
}

/** Microdollars → cents (exact Decimal). */
export function microToCents(micro: Microdollars): Decimal {
  return new Decimal(micro.toString()).div(10_000);
}

/** Cents → microdollars. */
export function centsToMicro(cents: Num): Microdollars {
  return roundToBigInt(new Decimal(cents as Decimal.Value).times(10_000));
}

/** Price stored as microdollars → probability 0..1 (Decimal). */
export function microToProbability(priceMicro: Microdollars): Decimal {
  return microToDollars(priceMicro);
}

/** Probability 0..1 → price microdollars. */
export function probabilityToMicro(p: Num): Microdollars {
  return dollarsToMicro(p);
}

// --- math -------------------------------------------------------------------

/**
 * Notional = price × size, in integer microdollars.
 * `priceMicro` is the per-share price in microdollars (0..1e6); `size` is shares.
 */
export function notionalMicro(priceMicro: Microdollars, size: Num): Microdollars {
  const price = microToDollars(priceMicro);
  return dollarsToMicro(price.times(new Decimal(size as Decimal.Value)));
}

/** Apply a bps rate to a microdollar amount (floor, integer division). */
export function applyBps(micro: Microdollars, bps: bigint): Microdollars {
  return (micro * bps) / BPS_DENOMINATOR;
}

/** Sum of microdollar amounts (no drift). */
export function sumMicro(values: Iterable<Microdollars>): Microdollars {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

// --- wire parse/format ------------------------------------------------------

/** Parse a microdollar value off the wire (string|number|bigint) to bigint. */
export function parseMicro(value: string | number | bigint): Microdollars {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError(`microdollars must be an integer, got ${value}`);
    }
    return BigInt(value);
  }
  return BigInt(value);
}

// --- display formatters -----------------------------------------------------

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

/** `$1,234.56` (or compact `$1.2K`/`$3.4M` when `compact`). */
export function formatDollars(micro: Microdollars, opts?: { compact?: boolean }): string {
  const dollars = microToDollars(micro);
  if (opts?.compact) return usdCompact.format(dollars.toNumber());
  return `$${dollars.toFixed(2)}`;
}

/** `54.0¢` — Kalshi/Polymarket cents display. */
export function formatCents(micro: Microdollars, dp = 1): string {
  return `${microToCents(micro).toDecimalPlaces(dp).toString()}¢`;
}
