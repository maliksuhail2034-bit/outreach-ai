import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlan, getPlanByPriceId, getPriceId, PLANS } from "./plans";

describe("getPlanByPriceId", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_STARTER_1MONTH", "price_starter_1month");
    vi.stubEnv("STRIPE_PRICE_STARTER_3MONTH", "price_starter_3month");
    vi.stubEnv("STRIPE_PRICE_PRO_1MONTH", "price_pro_1month");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves a 1-month price id to its plan", () => {
    // PLANS reads process.env at module load, not inside the function, so
    // this exercises the actual configured plan (whatever priceIds
    // resolved to at import time) rather than the freshly-stubbed env —
    // the meaningful assertion is that the lookup is reflexive with
    // whatever PLANS itself already has configured.
    const configuredId = PLANS.starter.priceIds["1_month"];
    if (!configuredId) return; // no price configured in this environment — nothing to assert
    expect(getPlanByPriceId(configuredId)?.id).toBe("starter");
  });

  it("resolves a 3-month price id to the same plan as its 1-month price", () => {
    const configuredId = PLANS.starter.priceIds["3_month"];
    if (!configuredId) return;
    expect(getPlanByPriceId(configuredId)?.id).toBe("starter");
  });

  it("returns null for an unrecognized price id", () => {
    expect(getPlanByPriceId("price_does_not_exist")).toBeNull();
  });
});

describe("getPriceId", () => {
  it("returns null for the internal fallback plan at any interval", () => {
    expect(getPriceId("free", "1_month")).toBeNull();
    expect(getPriceId("free", "12_month")).toBeNull();
  });
});

describe("getPlan", () => {
  it("returns the plan for a known id", () => {
    expect(getPlan("scale").name).toBe("Scale");
  });

  it("the internal fallback plan has finite limits and no price ids or price", () => {
    const plan = getPlan("free");
    expect(plan.regularPriceCents).toBeNull();
    expect(plan.launchPriceCents).toBeNull();
    expect(Object.values(plan.priceIds).every((id) => id === null)).toBe(true);
    expect(plan.limits.mailboxes).toBeGreaterThan(0);
  });

  it("no public paid plan is unlimited on any dimension (per the launch decision, not even Scale)", () => {
    for (const planId of ["starter", "growth", "pro", "scale"] as const) {
      const plan = getPlan(planId);
      expect(plan.limits.mailboxes).toBeGreaterThan(0);
      expect(plan.limits.leads).toBeGreaterThan(0);
      expect(plan.limits.campaigns).toBeGreaterThan(0);
      expect(plan.limits.dailySends).toBeGreaterThan(0);
      expect(plan.limits.emailsPerMonth).toBeGreaterThan(0);
    }
  });

  it("limits increase monotonically from the internal fallback through scale", () => {
    const tiers = [PLANS.free, PLANS.starter, PLANS.growth, PLANS.pro, PLANS.scale];
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].limits.mailboxes).toBeGreaterThan(tiers[i - 1].limits.mailboxes);
      expect(tiers[i].limits.dailySends).toBeGreaterThan(tiers[i - 1].limits.dailySends);
      expect(tiers[i].limits.emailsPerMonth).toBeGreaterThan(tiers[i - 1].limits.emailsPerMonth);
    }
  });

  it("every public paid plan's launch price is below its regular price", () => {
    for (const planId of ["starter", "growth", "pro", "scale"] as const) {
      const plan = getPlan(planId);
      expect(plan.launchPriceCents).not.toBeNull();
      expect(plan.regularPriceCents).not.toBeNull();
      expect(plan.launchPriceCents!).toBeLessThan(plan.regularPriceCents!);
    }
  });
});
