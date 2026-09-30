import { describe, expect, it } from "vitest";
import {
  calculateAllIntervalPrices,
  calculateIntervalPrice,
  calculateIntervalPriceInrPaise,
  formatCents,
  formatPlanPrice,
} from "./pricing";
import { PLANS } from "./plans";

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

  it("USD prices are unchanged by the INR conversion work — still a plain $ string with no thousands separator", () => {
    // Guards against formatCents ever being swapped for the new
    // currency-aware formatMoney() (which DOES add thousands separators —
    // see currency.test.ts) — existing USD call sites must keep this exact
    // plain-decimal shape.
    expect(formatCents(171840)).toBe("$1718.40");
  });
});

// The exact INR paise amount Razorpay will charge for every real plan and
// interval, at the approved fixed rate (96 — see lib/billing/currency.ts).
// Each expected value is USD totalCents (already verified above/in the
// pricing spec) * 96, worked out independently rather than by re-deriving
// the same formula, so this catches a regression in either the USD math or
// the INR conversion, not just one in isolation.
describe("calculateIntervalPriceInrPaise", () => {
  it.each([
    ["starter", "1_month", 1200, 115200],
    ["starter", "3_month", 3420, 328320],
    ["starter", "6_month", 6480, 622080],
    ["starter", "12_month", 11520, 1105920],
    ["growth", "1_month", 2200, 211200],
    ["growth", "3_month", 6270, 601920],
    ["growth", "6_month", 11880, 1140480],
    ["growth", "12_month", 21120, 2027520],
    ["pro", "1_month", 5200, 499200],
    ["pro", "3_month", 14820, 1422720],
    ["pro", "6_month", 28080, 2695680],
    ["pro", "12_month", 49920, 4792320],
    ["scale", "1_month", 17900, 1718400],
    ["scale", "3_month", 51015, 4897440],
    ["scale", "6_month", 96660, 9279360],
    ["scale", "12_month", 171840, 16496640],
  ] as const)(
    "%s at %s: USD total %i cents -> INR %i paise",
    (planId, interval, expectedUsdCents, expectedInrPaise) => {
      const launchPriceCents = PLANS[planId].launchPriceCents!;
      // Sanity-checks the worked example itself still matches the plan's
      // real USD price before asserting the INR conversion built on it.
      expect(calculateIntervalPrice(launchPriceCents, interval).totalCents).toBe(expectedUsdCents);
      expect(calculateIntervalPriceInrPaise(launchPriceCents, interval)).toBe(expectedInrPaise);
    },
  );

  it("never produces floating-point drift for any configured plan/interval", () => {
    for (const planId of ["starter", "growth", "pro", "scale"] as const) {
      for (const interval of ["1_month", "3_month", "6_month", "12_month"] as const) {
        const result = calculateIntervalPriceInrPaise(PLANS[planId].launchPriceCents!, interval);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });

  it("does not mutate or affect the USD calculation it's derived from (no cross-contamination)", () => {
    const launchPriceCents = PLANS.starter.launchPriceCents!;
    const usdBefore = calculateIntervalPrice(launchPriceCents, "12_month");
    calculateIntervalPriceInrPaise(launchPriceCents, "12_month");
    const usdAfter = calculateIntervalPrice(launchPriceCents, "12_month");
    expect(usdAfter).toEqual(usdBefore);
    expect(usdAfter.totalCents).toBe(11520); // still cents, never scaled by the INR rate
  });
});

// Region-based display (lib/billing/region.ts picks the currency). Pinned to
// the approved launch prices so neither currency can drift.
describe("formatPlanPrice", () => {
  const EXPECTED_USD: Record<string, string[]> = {
    starter: ["$12.00", "$34.20", "$64.80", "$115.20"],
    growth: ["$22.00", "$62.70", "$118.80", "$211.20"],
    pro: ["$52.00", "$148.20", "$280.80", "$499.20"],
    scale: ["$179.00", "$510.15", "$966.60", "$1718.40"],
  };
  const EXPECTED_INR: Record<string, string[]> = {
    starter: ["₹1,152.00", "₹3,283.20", "₹6,220.80", "₹11,059.20"],
    growth: ["₹2,112.00", "₹6,019.20", "₹11,404.80", "₹20,275.20"],
    pro: ["₹4,992.00", "₹14,227.20", "₹26,956.80", "₹47,923.20"],
    scale: ["₹17,184.00", "₹48,974.40", "₹92,793.60", "₹1,64,966.40"],
  };
  const INTERVALS = ["1_month", "3_month", "6_month", "12_month"] as const;

  it.each(Object.keys(EXPECTED_USD))("%s in USD matches the approved prices for every duration", (planId) => {
    const plan = PLANS[planId as keyof typeof PLANS];
    INTERVALS.forEach((interval, i) => {
      expect(formatPlanPrice(plan.launchPriceCents!, plan.regularPriceCents!, interval, "USD").total).toBe(EXPECTED_USD[planId][i]);
    });
  });

  it.each(Object.keys(EXPECTED_INR))("%s in INR matches the Razorpay plan amounts for every duration", (planId) => {
    const plan = PLANS[planId as keyof typeof PLANS];
    INTERVALS.forEach((interval, i) => {
      expect(formatPlanPrice(plan.launchPriceCents!, plan.regularPriceCents!, interval, "INR").total).toBe(EXPECTED_INR[planId][i]);
    });
  });

  it("derives the crossed-out regular price from the same currency and duration", () => {
    expect(formatPlanPrice(1200, 1900, "1_month", "USD").regular).toBe("$19.00");
    expect(formatPlanPrice(1200, 1900, "3_month", "USD").regular).toBe("$57.00");
    expect(formatPlanPrice(1200, 1900, "1_month", "INR").regular).toBe("₹1,824.00");
  });
});
