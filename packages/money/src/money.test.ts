import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  centsToMicro,
  dollarsToMicro,
  formatCents,
  formatDollars,
  microToCents,
  microToDollars,
  notionalMicro,
  parseMicro,
  sumMicro,
  MICRO_PER_DOLLAR,
} from "./money.js";
import { effectiveFeeRate, feeRateBps, grossUpRequiredBalance, unrealizedPnlMicro } from "./fees.js";

describe("microdollar conversions", () => {
  it("round-trips dollars", () => {
    expect(dollarsToMicro(1)).toBe(1_000_000n);
    expect(dollarsToMicro("2.50")).toBe(2_500_000n);
    expect(microToDollars(2_500_000n).toString()).toBe("2.5");
  });

  it("maps cents correctly ($1 = 100¢ = 1e6 micro)", () => {
    expect(centsToMicro(54)).toBe(540_000n);
    expect(microToCents(540_000n).toString()).toBe("54");
    expect(MICRO_PER_DOLLAR).toBe(1_000_000n);
  });

  it("parses wire values and rejects non-integer numbers", () => {
    expect(parseMicro("1000000")).toBe(1_000_000n);
    expect(parseMicro(42)).toBe(42n);
    expect(() => parseMicro(1.5)).toThrow();
  });
});

describe("no float drift discipline", () => {
  it("sums 1,000,000 × $0.07 with zero drift (the classic float failure)", () => {
    const seven = dollarsToMicro("0.07"); // 70_000n
    const many = Array.from({ length: 1_000_000 }, () => seven);
    const total = sumMicro(many);
    expect(total).toBe(70_000_000_000n); // exactly $70,000.00
    expect(microToDollars(total).toString()).toBe("70000");
  });

  it("notional price×size stays exact", () => {
    // price 0.33 (330_000 micro) × 333 shares = $109.89
    const n = notionalMicro(330_000n, 333);
    expect(n).toBe(109_890_000n);
    expect(formatDollars(n)).toBe("$109.89");
  });
});

describe("fee math (bible §7)", () => {
  it("effectiveRate = 0.08 × (1 − price)", () => {
    expect(effectiveFeeRate(0).toString()).toBe("0.08");
    expect(effectiveFeeRate(0.5).toString()).toBe("0.04");
    expect(effectiveFeeRate(1).toString()).toBe("0");
  });

  it("feeRateBps = ceil((effective + builder) × 1e4)", () => {
    // price 0.5 → effective 0.04 → 400 bps; +builder 100 → 500
    expect(feeRateBps(0.5)).toBe(400n);
    expect(feeRateBps(0.5, { builder: true })).toBe(500n);
    // price 0.555 → 0.08*0.445 = 0.0356 → 356 bps (ceil)
    expect(feeRateBps(0.555)).toBe(356n);
  });

  it("grosses up required balance by the fee", () => {
    expect(grossUpRequiredBalance(1_000_000n, 500n)).toBe(1_050_000n);
  });

  it("unrealized PnL = (price − avgEntry) × size", () => {
    // entry 0.40, now 0.55, 100 shares → +$15.00
    expect(unrealizedPnlMicro(550_000n, 400_000n, 100)).toBe(15_000_000n);
  });
});

describe("formatters", () => {
  it("formats cents and compact dollars", () => {
    expect(formatCents(540_000n)).toBe("54¢");
    expect(formatDollars(1_234_560_000n)).toBe("$1234.56");
    expect(formatDollars(1_234_560_000n, { compact: true })).toMatch(/\$1\.2[0-9]?K/);
  });

  it("Decimal inputs are accepted", () => {
    expect(dollarsToMicro(new Decimal("3.14"))).toBe(3_140_000n);
  });
});
