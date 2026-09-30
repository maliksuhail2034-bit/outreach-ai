import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
import { checkoutProviderForRegion, currencyForRegion, type BillingRegion } from "@/lib/billing/region";
import { PlanList } from "./plan-list";

type PlanIds = Record<PaidPlanId, Record<BillingInterval, string | null>>;

function planIds(value: string | null): PlanIds {
  return Object.fromEntries(
    PAID_PLAN_IDS.map((planId) => [planId, Object.fromEntries(BILLING_INTERVALS.map((i) => [i, value && `${value}_${planId}_${i}`]))]),
  ) as PlanIds;
}

// Rendered the way app/(app)/billing/page.tsx does: region resolved on the
// server, then only its currency/provider handed to the client component.
function renderFor(region: BillingRegion, overrides: Partial<Parameters<typeof PlanList>[0]> = {}) {
  const provider = checkoutProviderForRegion(region);
  return renderToStaticMarkup(
    createElement(PlanList, {
      currentPlanId: "free",
      razorpayPlanIds: planIds(provider === "razorpay" ? "plan" : null),
      planChangeBlocked: false,
      currency: currencyForRegion(region),
      checkoutProvider: provider,
      ...overrides,
    }),
  );
}

describe("PlanList by billing region", () => {
  it("India: INR prices with a Razorpay checkout on every plan", () => {
    const html = renderFor("india");

    for (const amount of ["₹1,152.00", "₹2,112.00", "₹4,992.00", "₹17,184.00"]) expect(html).toContain(amount);
    expect(html).not.toMatch(/\$\d/);
    expect(html.match(/data-checkout="razorpay"/g)).toHaveLength(4);
    expect(html).toContain("Billed in INR via Razorpay");
    expect(html).not.toContain("International checkout coming soon");
  });

  it("international: USD prices, no Razorpay checkout, and an honest coming-soon state", () => {
    const html = renderFor("international");

    for (const amount of ["$12.00", "$22.00", "$52.00", "$179.00"]) expect(html).toContain(amount);
    expect(html).not.toContain("₹");
    expect(html).not.toContain("Charged as");
    expect(html).not.toContain("Razorpay");
    expect(html).not.toContain('data-checkout="razorpay"');
    expect(html).not.toContain('data-checkout="stripe"');
    expect(html.match(/International checkout coming soon/g)).toHaveLength(4);
  });

  it("unknown country renders exactly like international (USD, no checkout)", async () => {
    const { billingRegionForCountry } = await import("@/lib/billing/region");
    expect(renderFor(billingRegionForCountry(null))).toBe(renderFor("international"));
  });

  it("international never gets a Razorpay checkout even if Razorpay plan ids were passed", () => {
    const html = renderFor("international", { razorpayPlanIds: planIds("plan") });

    expect(html).not.toContain('data-checkout="razorpay"');
    expect(html).not.toContain("₹");
  });

  it("keeps the existing current-plan and plan-change-blocked states ahead of region", () => {
    const current = renderFor("international", { currentPlanId: "starter" });
    expect(current).toContain("Current plan");

    const blocked = renderFor("international", { planChangeBlocked: true });
    expect(blocked).toContain("Plan changes not available yet");
    expect(blocked).not.toContain("International checkout coming soon");
  });
});
