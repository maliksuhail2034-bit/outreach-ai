import { describe, expect, it } from "vitest";

import type { Tables } from "@/types/database.types";
import { buildCustomerRows, countCustomersByPlan, isPayingCustomer, type CustomerInputs } from "./customers";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const INTERNAL_ORG = "7ef89392-80ba-4447-a7b7-ba642ff00a53";

function org(id: string, owner = `owner-${id}`) {
  return { id, name: `Workspace ${id}`, owner_user_id: owner, created_at: "2026-10-01T00:00:00.000Z" };
}

function v2(organizationId: string, overrides: Partial<Tables<"subscriptions_v2">> = {}): Tables<"subscriptions_v2"> {
  return {
    id: `sub-${organizationId}`,
    organization_id: organizationId,
    provider: "razorpay",
    provider_plan_id: "plan_x",
    provider_status: "active",
    provider_subscription_id: `sub_${organizationId}`,
    normalized_status: "active",
    internal_plan_id: "growth",
    billing_interval: "1_month",
    currency: "INR",
    current_period_start: "2026-11-01T00:00:00.000Z",
    current_period_end: "2026-12-01T00:00:00.000Z",
    cancel_at_period_end: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function inputs(overrides: Partial<CustomerInputs> = {}): CustomerInputs {
  return {
    organizations: [],
    legacySubscriptions: [],
    subscriptionsV2: [],
    allocations: [],
    users: [],
    ...overrides,
  };
}

describe("buildCustomerRows", () => {
  it("resolves each organization's plan with billing's own precedence rules", () => {
    const rows = buildCustomerRows(
      inputs({
        organizations: [org("a"), org("b"), org("c")],
        subscriptionsV2: [
          v2("a"),
          // Granting status but the paid period ran out with no renewal: no access.
          v2("b", { current_period_end: "2026-09-01T00:00:00.000Z" }),
        ],
      }),
      NOW,
    );

    expect(rows.map((row) => [row.organizationId, row.planId, row.subscription.grantsAccess])).toEqual([
      ["a", "growth", true],
      ["b", "free", false],
      ["c", "free", false],
    ]);
    expect(rows[0].planName).toBe("Growth");
    expect(rows[1].subscription.periodLapsed).toBe(true);
    expect(rows[2].subscription.normalizedStatus).toBeNull();
  });

  it("joins the owner's email, staff flag and this month's allocation", () => {
    const [row] = buildCustomerRows(
      inputs({
        organizations: [org("a", "user-1")],
        users: [{ id: "user-1", email: "jane@acme.com", app_metadata: { polimatiq_staff: true } }],
        allocations: [{ organization_id: "a", delivered_count: 40, quota: 100 }],
      }),
      NOW,
    );
    expect(row.ownerEmail).toBe("jane@acme.com");
    expect(row.ownerIsStaff).toBe(true);
    expect(row.verifiedLeads).toEqual({ delivered: 40, quota: 100 });
  });

  it("handles a missing owner account and no allocation", () => {
    const [row] = buildCustomerRows(inputs({ organizations: [org("a")] }), NOW);
    expect(row.ownerEmail).toBeNull();
    expect(row.ownerIsStaff).toBe(false);
    expect(row.verifiedLeads).toBeNull();
  });

  it("labels Polimatiq's internal workspace and never counts it as a customer", () => {
    const rows = buildCustomerRows(
      inputs({ organizations: [org(INTERNAL_ORG), org("a")], subscriptionsV2: [v2(INTERNAL_ORG), v2("a", { internal_plan_id: "pro" })] }),
      NOW,
    );
    const internal = rows.find((row) => row.organizationId === INTERNAL_ORG)!;
    expect(internal.internal).toBe(true);
    expect(internal.planName).toBe("Internal (unlimited)");
    expect(isPayingCustomer(internal)).toBe(false);
    expect(countCustomersByPlan(rows)).toEqual({ free: 0, starter: 0, growth: 0, pro: 1, scale: 0 });
  });
});

describe("countCustomersByPlan", () => {
  it("counts paying customers per plan and everyone else under free", () => {
    const rows = buildCustomerRows(
      inputs({
        organizations: [org("a"), org("b"), org("c"), org("d")],
        subscriptionsV2: [v2("a"), v2("b"), v2("c", { normalized_status: "cancelled" })],
      }),
      NOW,
    );
    expect(countCustomersByPlan(rows)).toEqual({ free: 2, starter: 0, growth: 2, pro: 0, scale: 0 });
  });
});
