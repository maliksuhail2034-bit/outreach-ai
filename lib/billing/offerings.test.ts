import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPlanOffering,
  getPlanOfferingGrid,
  INDIA_MAX_TRANSACTION_PAISE,
  razorpayPlanEnvVar,
  requiresRecurringAuthentication,
  toPlanOfferingView,
} from "./offerings";
import { BILLING_INTERVALS, PAID_PLAN_IDS, PLANS, type BillingInterval, type PaidPlanId } from "./plans";
import { calculateIntervalPrice, calculateIntervalPriceInrPaise, formatPlanPrice } from "./pricing";
import type { Currency } from "./currency";

const ALL_OFFERINGS = PAID_PLAN_IDS.flatMap((planId) => BILLING_INTERVALS.map((interval) => [planId, interval] as const));

function configureAll(currency: Currency) {
  for (const [planId, interval] of ALL_OFFERINGS) {
    vi.stubEnv(razorpayPlanEnvVar(planId, interval, currency), `plan_${currency}_${planId}_${interval}`);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("razorpayPlanEnvVar", () => {
  it("keeps the existing INR variable names unchanged", () => {
    expect(ALL_OFFERINGS.map(([planId, interval]) => razorpayPlanEnvVar(planId, interval, "INR"))).toEqual([
      "RAZORPAY_PLAN_STARTER_1MONTH",
      "RAZORPAY_PLAN_STARTER_3MONTH",
      "RAZORPAY_PLAN_STARTER_6MONTH",
      "RAZORPAY_PLAN_STARTER_12MONTH",
      "RAZORPAY_PLAN_GROWTH_1MONTH",
      "RAZORPAY_PLAN_GROWTH_3MONTH",
      "RAZORPAY_PLAN_GROWTH_6MONTH",
      "RAZORPAY_PLAN_GROWTH_12MONTH",
      "RAZORPAY_PLAN_PRO_1MONTH",
      "RAZORPAY_PLAN_PRO_3MONTH",
      "RAZORPAY_PLAN_PRO_6MONTH",
      "RAZORPAY_PLAN_PRO_12MONTH",
      "RAZORPAY_PLAN_SCALE_1MONTH",
      "RAZORPAY_PLAN_SCALE_3MONTH",
      "RAZORPAY_PLAN_SCALE_6MONTH",
      "RAZORPAY_PLAN_SCALE_12MONTH",
    ]);
  });

  it("names the 16 USD variables with a _USD suffix", () => {
    const names = ALL_OFFERINGS.map(([planId, interval]) => razorpayPlanEnvVar(planId, interval, "USD"));
    expect(names).toHaveLength(16);
    expect(new Set(names).size).toBe(16);
    for (const name of names) expect(name).toMatch(/^RAZORPAY_PLAN_(STARTER|GROWTH|PRO|SCALE)_(1|3|6|12)MONTH_USD$/);
  });
});

describe("getPlanOffering — INR", () => {
  it.each(ALL_OFFERINGS)("%s %s: amount and display are exactly the existing INR pricing", (planId, interval) => {
    const plan = PLANS[planId];
    const offering = getPlanOffering(planId, interval, "INR");

    expect(offering.currency).toBe("INR");
    expect(offering.amount).toBe(calculateIntervalPriceInrPaise(plan.launchPriceCents!, interval));
    expect(offering.price).toEqual(formatPlanPrice(plan.launchPriceCents!, plan.regularPriceCents!, interval, "INR"));
  });

  it("is available, with its plan id, when the INR env var is set", () => {
    vi.stubEnv("RAZORPAY_PLAN_PRO_3MONTH", "plan_inr_pro_3m");

    expect(getPlanOffering("pro", "3_month", "INR")).toMatchObject({
      availability: "available",
      razorpayPlanId: "plan_inr_pro_3m",
      amount: 1_422_720,
      price: { total: "₹14,227.20" },
    });
  });
});

describe("getPlanOffering — USD", () => {
  it.each(ALL_OFFERINGS)("%s %s: amount is the USD price in cents", (planId, interval) => {
    const offering = getPlanOffering(planId, interval, "USD");

    expect(offering.currency).toBe("USD");
    expect(offering.amount).toBe(calculateIntervalPrice(PLANS[planId].launchPriceCents!, interval).totalCents);
    expect(offering.price.total).toMatch(/^\$/);
  });

  it("is available, with the USD plan id, when the USD env var is set", () => {
    vi.stubEnv("RAZORPAY_PLAN_STARTER_1MONTH_USD", "plan_usd_starter_1m");

    expect(getPlanOffering("starter", "1_month", "USD")).toMatchObject({
      availability: "available",
      razorpayPlanId: "plan_usd_starter_1m",
      amount: 1_200,
      price: { total: "$12.00" },
    });
  });

  it.each([undefined, ""])("is not configured (and carries no plan id) when the USD env var is %j", (value) => {
    vi.stubEnv("RAZORPAY_PLAN_STARTER_1MONTH", "plan_inr_starter_1m");
    if (value !== undefined) vi.stubEnv("RAZORPAY_PLAN_STARTER_1MONTH_USD", value);

    const offering = getPlanOffering("starter", "1_month", "USD");

    expect(offering.availability).toBe("not_configured");
    expect(offering.razorpayPlanId).toBeNull();
    expect(offering.razorpayPlanEnvVar).toBe("RAZORPAY_PLAN_STARTER_1MONTH_USD");
  });

  it("never falls back to an INR plan id, for any offering", () => {
    configureAll("INR");

    for (const [planId, interval] of ALL_OFFERINGS) {
      const offering = getPlanOffering(planId, interval, "USD");
      expect(offering.availability).toBe("not_configured");
      expect(offering.razorpayPlanId).toBeNull();
    }
  });
});

describe("India transaction limit", () => {
  it.each(["6_month", "12_month"] as const)("Scale %s isn't sold in INR even with a plan id configured", (interval) => {
    configureAll("INR");

    const offering = getPlanOffering("scale", interval, "INR");

    expect(offering.availability).toBe("not_sold");
    expect(offering.razorpayPlanId).toBeNull();
  });

  it.each(["6_month", "12_month"] as const)("Scale %s is still sold in USD", (interval) => {
    configureAll("USD");

    expect(getPlanOffering("scale", interval, "USD")).toMatchObject({ availability: "available" });
  });

  it("every INR offering that is sold fits the ₹50,000 limit, and every one that isn't exceeds it", () => {
    configureAll("INR");

    for (const [planId, interval] of ALL_OFFERINGS) {
      const offering = getPlanOffering(planId, interval, "INR");
      if (offering.availability === "not_sold") expect(offering.amount).toBeGreaterThan(INDIA_MAX_TRANSACTION_PAISE);
      else expect(offering.amount).toBeLessThanOrEqual(INDIA_MAX_TRANSACTION_PAISE);
    }
  });
});

describe("recurring payments over ₹15,000", () => {
  it("flags exactly the INR offerings whose per-cycle charge is over ₹15,000", () => {
    const flagged = ALL_OFFERINGS.filter(
      ([planId, interval]) => getPlanOffering(planId, interval, "INR").requiresRecurringAuthentication,
    ).map(([planId, interval]) => `${planId}:${interval}`);

    expect(flagged).toEqual([
      "growth:12_month",
      "pro:6_month",
      "pro:12_month",
      "scale:1_month",
      "scale:3_month",
      "scale:6_month",
      "scale:12_month",
    ]);
  });

  it("never flags a USD offering", () => {
    for (const [planId, interval] of ALL_OFFERINGS) {
      expect(getPlanOffering(planId, interval, "USD").requiresRecurringAuthentication).toBe(false);
    }
  });

  it("is strictly over ₹15,000, not at it", () => {
    expect(requiresRecurringAuthentication(1_500_000, "INR")).toBe(false);
    expect(requiresRecurringAuthentication(1_500_001, "INR")).toBe(true);
  });
});

describe("toPlanOfferingView / getPlanOfferingGrid", () => {
  it("never exposes a plan id or env var name to the client", () => {
    configureAll("USD");

    const view = toPlanOfferingView(getPlanOffering("growth", "3_month", "USD"));

    expect(view).not.toHaveProperty("razorpayPlanId");
    expect(view).not.toHaveProperty("razorpayPlanEnvVar");
    expect(JSON.stringify(view)).not.toContain("plan_USD");
  });

  it("resolves all 16 offerings for a currency", () => {
    configureAll("INR");

    const grid = getPlanOfferingGrid("INR");

    for (const [planId, interval] of ALL_OFFERINGS) {
      const offering = grid[planId as PaidPlanId][interval as BillingInterval];
      expect(offering).toMatchObject({ planId, interval, currency: "INR" });
    }
    expect(grid.scale["12_month"].availability).toBe("not_sold");
    expect(grid.starter["1_month"].availability).toBe("available");
  });
});
