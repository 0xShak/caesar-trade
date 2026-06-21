import { formatCents, formatDollars } from "@caesar/money";

/**
 * Coerce a wire money value to microdollars (bigint), null-safe.
 *
 * The API returns amount Floats (volume, liquidity, volume24h, …) as
 * integer-valued microdollars, and probability Floats (midPoint, spread) as
 * 0..1. This helper just rounds whatever number it's handed into a bigint of
 * the same scale; callers decide which scale they're feeding it.
 */
export function toMicro(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n));
}

/** Format a microdollar amount Float (e.g. volume) for display. */
export function fmtAmount(
  value: string | number | null | undefined,
  opts?: { compact?: boolean },
): string {
  const micro = toMicro(value);
  return micro !== null ? formatDollars(micro, opts) : "—";
}

/** Format a 0..1 probability as cents, e.g. 0.47 -> "47.0¢". */
export function fmtProbCents(
  prob: string | number | null | undefined,
  dp = 1,
): string {
  const micro = toMicro(
    prob === null || prob === undefined ? null : Number(prob) * 1_000_000,
  );
  return micro !== null ? formatCents(micro, dp) : "—";
}

/** Format a 0..1 probability as a percent string, e.g. 0.47 -> "47.0%". */
export function fmtProbPct(
  prob: string | number | null | undefined,
  dp = 1,
): string {
  if (prob === null || prob === undefined) return "—";
  const n = Number(prob);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(dp)}%`;
}

/** Apply the dark-mono platform pill class for a venue. */
export function platformClass(platform: string | null | undefined): string {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("poly")) return "pill platform-poly";
  if (p.includes("kalshi")) return "pill platform-kalshi";
  return "pill";
}

/** Short, locale-stable date for end dates etc. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** Truncate a long external id for display, keeping head + tail. */
export function truncId(id: string | null | undefined, head = 8, tail = 6): string {
  if (!id) return "—";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
