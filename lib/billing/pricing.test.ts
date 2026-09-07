import { describe, expect, it } from "vitest";
import { calculateAllIntervalPrices, calculateIntervalPrice, formatCents } from "./pricing";

// Exercises the exact worked example from the pricing spec: Starter's
// launch price is $12/month (1200 cents).
describe("calculateIntervalPrice", () => {
  it("charges exactly the launch price with no discount at 1 month", () => {
    const result = calculateIntervalPrice(1200, "1_month");
    expect(result.months).toBe(1);
    expect(result.discountPercent).toBe(0);
    expect(result.totalCents).toBe(1200);
    expect(result.undiscountedTotalCents).toBe(1200);
    expect(result.savingsCents).toBe(0);
    expect(result.effectiveMonthlyCents).toBe(1200);
  });

  it("applies a 5% discount off the launch price at 3 months: 12 * 3 * 0.95 = 34.20", () => {
    const result = calculateIntervalPrice(1200, "3_month");
    expect(result.months).toBe(3);
    expect(result.discountPercent).toBe(5);
    expect(result.undiscountedTotalCents).toBe(3600);
    expect(result.totalCents).toBe(3420);
    expect(result.savingsCents).toBe(180);
  });

  it("applies a 10% discount off the launch price at 6 months: 12 * 6 * 0.90 = 64.80", () => {
    const result = calculateIntervalPrice(1200, "6_month");
    expect(result.months).toBe(6);
    expect(result.discountPercent).toBe(10);
    expect(result.undiscountedTotalCents).toBe(7200);
    expect(result.totalCents).toBe(6480);
    expect(result.savingsCents).toBe(720);
  });

  it("applies a 20% discount off the launch price at 12 months: 12 * 12 * 0.80 = 115.20", () => {
    const result = calculateIntervalPrice(1200, "12_month");
    expect(result.months).toBe(12);
    expect(result.discountPercent).toBe(20);
    expect(result.undiscountedTotalCents).toBe(14400);
    expect(result.totalCents).toBe(11520);
    expect(result.savingsCents).toBe(2880);
  });

  it("computes the effective per-month rate at the discounted total, not the launch price", () => {
    // 12-month Starter: $115.20 total / 12 months = $9.60/mo effective.
    const result = calculateIntervalPrice(1200, "12_month");
    expect(result.effectiveMonthlyCents).toBe(960);
  });

  it("never produces floating-point drift for any configured plan's launch price", () => {
    // The classic 12 * 3 * 0.95 = 34.199999999999996 JS-float trap — every
    // real launch price (Starter 1200, Growth 2200, Pro 5200, Scale 17900)
    // must come out as a clean integer number of cents.
    for (const launchPriceCents of [1200, 2200, 5200, 17900]) {
      for (const interval of ["1_month", "3_month", "6_month", "12_month"] as const) {
        expect(Number.isInteger(calculateIntervalPrice(launchPriceCents, interval).totalCents)).toBe(true);
      }
    }
  });
});

describe("calculateAllIntervalPrices", () => {
  it("returns all 4 durations in order", () => {
    const results = calculateAllIntervalPrices(1200);
    expect(results.map((r) => r.interval)).toEqual(["1_month", "3_month", "6_month", "12_month"]);
  });
});

describe("formatCents", () => {
  it("formats whole dollars with two decimal places", () => {
    expect(formatCents(1200)).toBe("$12.00");
  });

  it("formats the 3-month Starter total exactly", () => {
    expect(formatCents(3420)).toBe("$34.20");
  });
});
