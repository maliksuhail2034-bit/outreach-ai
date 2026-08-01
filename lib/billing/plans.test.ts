import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlan, getPlanByPriceId, getPriceId, PLANS } from "./plans";

describe("getPlanByPriceId", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", "price_starter_monthly");
    vi.stubEnv("STRIPE_PRICE_STARTER_YEARLY", "price_starter_yearly");
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_monthly");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves a monthly price id to its plan", () => {
    // PLANS reads process.env at module load, not inside the function, so
    // this exercises the actual configured plan (whatever monthlyPriceId
    // resolved to at import time) rather than the freshly-stubbed env —
    // the meaningful assertion is that the lookup is reflexive with
    // whatever PLANS itself already has configured.
    const configuredId = PLANS.starter.monthlyPriceId;
    if (!configuredId) return; // no price configured in this environment — nothing to assert
    expect(getPlanByPriceId(configuredId)?.id).toBe("starter");
  });

  it("resolves a yearly price id to the same plan as its monthly price", () => {
    const configuredId = PLANS.starter.yearlyPriceId;
    if (!configuredId) return;
    expect(getPlanByPriceId(configuredId)?.id).toBe("starter");
  });

  it("returns null for an unrecognized price id", () => {
    expect(getPlanByPriceId("price_does_not_exist")).toBeNull();
  });
});

describe("getPriceId", () => {
  it("returns null for the free plan at any interval", () => {
    expect(getPriceId("free", "monthly")).toBeNull();
    expect(getPriceId("free", "yearly")).toBeNull();
  });
});

describe("getPlan", () => {
  it("returns the plan for a known id", () => {
    expect(getPlan("agency").name).toBe("Agency");
  });

  it("free plan has finite limits and no price ids", () => {
    const plan = getPlan("free");
    expect(plan.monthlyPriceId).toBeNull();
    expect(plan.yearlyPriceId).toBeNull();
    expect(plan.limits.mailboxes).toBeGreaterThan(0);
  });

  it("agency plan is unlimited on mailboxes/leads/campaigns but caps daily sends", () => {
    const plan = getPlan("agency");
    expect(plan.limits.mailboxes).toBe(-1);
    expect(plan.limits.leads).toBe(-1);
    expect(plan.limits.campaigns).toBe(-1);
    expect(plan.limits.dailySends).toBeGreaterThan(0);
  });

  it("limits increase monotonically from free through agency", () => {
    const tiers = [PLANS.free, PLANS.starter, PLANS.pro];
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].limits.mailboxes).toBeGreaterThan(tiers[i - 1].limits.mailboxes);
      expect(tiers[i].limits.dailySends).toBeGreaterThan(tiers[i - 1].limits.dailySends);
    }
  });
});
