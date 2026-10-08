import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Markers in place of the real checkout buttons (which pull in server
// actions and the router) — these tests only care which checkout, if any, a
// region is offered.
vi.mock("@/components/billing/razorpay-checkout-button", () => ({
  RazorpayCheckoutButton: () => createElement("button", { "data-checkout": "razorpay" }, "Upgrade"),
}));
vi.mock("@/components/billing/checkout-button", () => ({
  CheckoutButton: () => createElement("button", { "data-checkout": "stripe" }, "Coming soon"),
}));

import { BILLING_INTERVALS, PAID_PLAN_IDS, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";
import type { Currency } from "@/lib/billing/currency";
import { getPlanOffering, getPlanOfferingGrid, razorpayPlanEnvVar, toPlanOfferingView } from "@/lib/billing/offerings";
import { billingRegionForCountry, currencyForRegion, type BillingRegion } from "@/lib/billing/region";
import { OfferingAction, PlanList } from "./plan-list";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Sets (or clears) all 16 Razorpay plan id env vars for one currency.
function configurePlans(currency: Currency, configured: boolean) {
  for (const planId of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      vi.stubEnv(razorpayPlanEnvVar(planId, interval, currency), configured ? `plan_${currency}_${planId}_${interval}` : "");
    }
  }
}

// Rendered the way app/(app)/billing/page.tsx does: region resolved on the
// server, offerings resolved for its currency, then handed to the client
// component as plain data.
function renderFor(region: BillingRegion, overrides: Partial<Parameters<typeof PlanList>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PlanList, {
      currentPlanId: null,
      offerings: getPlanOfferingGrid(currencyForRegion(region)),
      planChangeBlocked: false,
      internalUnlimited: false,
      ...overrides,
    }),
  );
}

function renderAction(planId: PaidPlanId, interval: BillingInterval, currency: Currency) {
  return renderToStaticMarkup(
    createElement(OfferingAction, { offering: toPlanOfferingView(getPlanOffering(planId, interval, currency)) }),
  );
}

describe("PlanList by billing region", () => {
  it("India: INR prices with a Razorpay checkout on every plan", () => {
    configurePlans("INR", true);
    const html = renderFor("india");

    for (const amount of ["₹1,152.00", "₹2,112.00", "₹4,992.00", "₹17,184.00"]) expect(html).toContain(amount);
    expect(html).not.toMatch(/\$\d/);
    expect(html.match(/data-checkout="razorpay"/g)).toHaveLength(4);
    expect(html).toContain("Billed in INR via Razorpay");
    expect(html).not.toContain("International checkout coming soon");
  });

  it("international without USD plans: USD prices, no checkout, and an honest coming-soon state", () => {
    configurePlans("INR", true);
    configurePlans("USD", false);
    const html = renderFor("international");

    for (const amount of ["$12.00", "$22.00", "$52.00", "$179.00"]) expect(html).toContain(amount);
    expect(html).not.toContain("₹");
    expect(html).not.toContain('data-checkout="razorpay"');
    expect(html).not.toContain('data-checkout="stripe"');
    expect(html.match(/International checkout coming soon/g)).toHaveLength(4);
  });

  it("international with USD plans configured: USD prices with a Razorpay checkout billed in USD", () => {
    configurePlans("USD", true);
    const html = renderFor("international");

    for (const amount of ["$12.00", "$22.00", "$52.00", "$179.00"]) expect(html).toContain(amount);
    expect(html).not.toContain("₹");
    expect(html.match(/data-checkout="razorpay"/g)).toHaveLength(4);
    expect(html.match(/Billed in USD via Razorpay/g)).toHaveLength(4);
    expect(html).not.toContain("International checkout coming soon");
  });

  it("unknown country renders exactly like international", () => {
    configurePlans("USD", true);
    expect(renderFor(billingRegionForCountry(null))).toBe(renderFor("international"));
  });

  it("never offers international visitors a checkout on the INR plans", () => {
    configurePlans("INR", true);
    configurePlans("USD", false);
    const html = renderFor("international");

    expect(html).not.toContain('data-checkout="razorpay"');
    expect(html).not.toContain("Billed in INR");
  });

  it("keeps the existing current-plan and plan-change-blocked states ahead of availability", () => {
    configurePlans("USD", true);
    const current = renderFor("international", { currentPlanId: "starter" });
    expect(current).toContain("Current plan");

    const blocked = renderFor("international", { planChangeBlocked: true });
    expect(blocked).toContain("Plan changes not available yet");
    expect(blocked).not.toContain('data-checkout="razorpay"');
  });

  it("internal unlimited workspace: no card is its current plan and nothing is purchasable", () => {
    configurePlans("INR", true);
    const html = renderFor("india", { internalUnlimited: true });

    expect(html).not.toContain("Current plan");
    expect(html.match(/Included in Unlimited/g)).toHaveLength(4);
    expect(html).not.toContain("data-checkout");
  });
});

describe("OfferingAction", () => {
  it.each(["6_month", "12_month"] as const)("India: Scale %s is shown as unavailable, even with a plan id configured", (interval) => {
    configurePlans("INR", true);
    const html = renderAction("scale", interval, "INR");

    expect(html).toContain("Not available in India yet");
    expect(html).toContain("Payments over ₹50,000");
    expect(html).not.toContain("data-checkout");
  });

  it.each(["6_month", "12_month"] as const)("international: Scale %s is purchasable once its USD plan is configured", (interval) => {
    configurePlans("USD", true);
    const html = renderAction("scale", interval, "USD");

    expect(html).toContain('data-checkout="razorpay"');
    expect(html).toContain("Billed in USD");
  });

  it("warns that renewals need approval for an INR plan over ₹15,000", () => {
    configurePlans("INR", true);
    const html = renderAction("scale", "1_month", "INR");

    expect(html).toContain('data-checkout="razorpay"');
    expect(html).toContain("Each renewal is over ₹15,000");
    expect(html).toContain("OTP");
  });

  it("doesn't show the renewal warning for an INR plan under ₹15,000, or for any USD plan", () => {
    configurePlans("INR", true);
    configurePlans("USD", true);

    expect(renderAction("starter", "1_month", "INR")).not.toContain("₹15,000");
    expect(renderAction("scale", "1_month", "USD")).not.toContain("₹15,000");
  });
});
