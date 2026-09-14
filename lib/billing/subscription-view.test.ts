import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";

// Per-table mock — same pattern as lib/billing/limits.test.ts's
// createMockClient, narrowed to just the two tables this module reads.
// Critically, `subscriptions` and `subscriptions_v2` are tracked
// separately so a legacy-shaped mock row is never accidentally handed back
// for a subscriptions_v2 query (the exact bug the old single-mock
// resolve-plan.test.ts was at risk of once a second table read was added).
function createMockClient(overrides: { subscription?: Record<string, unknown> | null; subscriptionV2?: Record<string, unknown> | null }) {
  const tableResults: Record<string, { data: unknown; error: null }> = {
    subscriptions: { data: overrides.subscription ?? null, error: null },
    subscriptions_v2: { data: overrides.subscriptionV2 ?? null, error: null },
  };

  function createChainable(table: string) {
    const result = tableResults[table] ?? { data: null, error: null };
    const chainable = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    for (const method of ["select", "eq", "maybeSingle"] as const) {
      chainable[method].mockReturnValue(chainable);
    }
    return chainable;
  }

  const chainablesByTable: Record<string, ReturnType<typeof createChainable>> = {};
  const from = vi.fn((table: string) => {
    if (!chainablesByTable[table]) chainablesByTable[table] = createChainable(table);
    return chainablesByTable[table];
  });

  return { from } as unknown as Client;
}

function legacySubscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "active",
    stripe_price_id: "price_starter_1month",
    current_period_end: "2026-10-01T00:00:00.000Z",
    cancel_at_period_end: false,
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function v2Subscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider: "razorpay",
    internal_plan_id: "starter",
    normalized_status: "active",
    current_period_end: "2026-10-14T00:00:00.000Z",
    cancel_at_period_end: false,
    updated_at: "2026-09-14T00:00:00.000Z",
    id: "sub-v2-row-1",
    ...overrides,
  };
}

async function freshGetActiveSubscriptionView() {
  vi.resetModules();
  const freshModule = await import("./subscription-view");
  return freshModule.getActiveSubscriptionView;
}

describe("getActiveSubscriptionView", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_STARTER_1MONTH", "price_starter_1month");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns free/null when neither subscription exists (Step 4D)", async () => {
    const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
    const client = createMockClient({ subscription: null, subscriptionV2: null });

    expect(await getActiveSubscriptionView(client, "org-1")).toEqual({
      planId: "free",
      provider: null,
      normalizedStatus: null,
      grantsAccess: false,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });

  describe("V2-only organization", () => {
    it.each([
      ["active", true],
      ["past_due", true],
      ["pending", false],
      ["suspended", false],
      ["cancelled", false],
      ["expired", false],
      ["completed", false],
    ] as const)("normalized_status=%s -> grantsAccess=%s", async (status, grants) => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({ subscriptionV2: v2Subscription({ normalized_status: status }) });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.grantsAccess).toBe(grants);
      expect(view.planId).toBe(grants ? "starter" : "free");
      expect(view.provider).toBe("razorpay");
      expect(view.normalizedStatus).toBe(status);
    });

    it("exposes the v2 row's own currentPeriodEnd/cancelAtPeriodEnd", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscriptionV2: v2Subscription({ current_period_end: "2026-11-01T00:00:00.000Z", cancel_at_period_end: true }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.currentPeriodEnd).toBe("2026-11-01T00:00:00.000Z");
      expect(view.cancelAtPeriodEnd).toBe(true);
    });
  });

  describe("legacy status normalization", () => {
    it.each([
      ["active", "active", true],
      ["trialing", "trialing", true],
      ["past_due", "past_due", true],
      ["incomplete", "pending", false],
      ["unpaid", "suspended", false],
      ["paused", "suspended", false],
      ["canceled", "cancelled", false],
      ["incomplete_expired", "expired", false],
    ] as const)("legacy status=%s -> normalized=%s, grants=%s", async (legacyStatus, normalized, grants) => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({ subscription: legacySubscription({ status: legacyStatus }) });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.normalizedStatus).toBe(normalized);
      expect(view.grantsAccess).toBe(grants);
      expect(view.planId).toBe(grants ? "starter" : "free");
      if (grants) expect(view.provider).toBe("stripe");
    });

    it("fails closed to free when an active-looking legacy status has an unrecognized price id", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscription: legacySubscription({ stripe_price_id: "price_no_longer_configured" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.grantsAccess).toBe(false);
      expect(view.planId).toBe("free");
      // Status display is independent of plan resolution succeeding.
      expect(view.normalizedStatus).toBe("active");
    });
  });

  describe("both legacy and v2 exist", () => {
    it("legacy grants, v2 does not -> legacy wins", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscription: legacySubscription({ status: "active" }),
        subscriptionV2: v2Subscription({ normalized_status: "cancelled" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.provider).toBe("stripe");
      expect(view.planId).toBe("starter");
      expect(view.grantsAccess).toBe(true);
    });

    it("v2 grants, legacy does not -> v2 wins", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscription: legacySubscription({ status: "canceled" }),
        subscriptionV2: v2Subscription({ normalized_status: "active" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.provider).toBe("razorpay");
      expect(view.planId).toBe("starter");
      expect(view.grantsAccess).toBe(true);
    });

    it("both grant access -> v2 wins and a console.warn is emitted", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = createMockClient({
        subscription: legacySubscription({ status: "active" }),
        subscriptionV2: v2Subscription({ normalized_status: "active" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.provider).toBe("razorpay");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("org-1");
    });

    it("neither grants access -> free plan, display prefers the most recently updated (v2 newer)", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscription: legacySubscription({ status: "canceled", updated_at: "2026-01-01T00:00:00.000Z" }),
        subscriptionV2: v2Subscription({ normalized_status: "expired", updated_at: "2026-09-01T00:00:00.000Z" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.planId).toBe("free");
      expect(view.grantsAccess).toBe(false);
      expect(view.provider).toBe("razorpay");
      expect(view.normalizedStatus).toBe("expired");
    });

    it("neither grants access -> free plan, display prefers the most recently updated (legacy newer)", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscription: legacySubscription({ status: "canceled", updated_at: "2026-09-10T00:00:00.000Z" }),
        subscriptionV2: v2Subscription({ normalized_status: "expired", updated_at: "2026-01-01T00:00:00.000Z" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.planId).toBe("free");
      expect(view.provider).toBe("stripe");
      expect(view.normalizedStatus).toBe("cancelled");
    });
  });

  describe("fail-closed on unrecognized data", () => {
    it("an unrecognized normalized_status on the v2 row never grants access", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscriptionV2: v2Subscription({ normalized_status: "some_future_status_this_app_does_not_know" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.grantsAccess).toBe(false);
      expect(view.planId).toBe("free");
    });

    it("an unrecognized internal_plan_id on an otherwise-active v2 row fails closed to free", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const client = createMockClient({
        subscriptionV2: v2Subscription({ internal_plan_id: "some_plan_removed_from_plans_ts" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view.grantsAccess).toBe(false);
      expect(view.planId).toBe("free");
    });

    it("an unrecognized provider value on the v2 row is ignored entirely", async () => {
      const getActiveSubscriptionView = await freshGetActiveSubscriptionView();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = createMockClient({
        subscriptionV2: v2Subscription({ provider: "some_unknown_provider" }),
      });

      const view = await getActiveSubscriptionView(client, "org-1");
      expect(view).toEqual({
        planId: "free",
        provider: null,
        normalizedStatus: null,
        grantsAccess: false,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
