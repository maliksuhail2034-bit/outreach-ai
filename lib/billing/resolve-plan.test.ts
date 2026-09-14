import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";

// Per-table mock — same pattern as lib/billing/limits.test.ts and
// lib/billing/subscription-view.test.ts. getPlanForOrganization() now reads
// both `subscriptions` (legacy) and `subscriptions_v2` via
// getActiveSubscriptionView(), so a single shared mock chainable (the old
// approach here) would risk handing a legacy-shaped row back for the
// subscriptions_v2 query too — tracking results per table rules that out.
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

// PLANS (lib/billing/plans.ts) reads its Stripe price ids from process.env
// once, at module load — correct for a running server (env vars are static
// per deployment) but it means stubbing an env var after the module is
// already imported has no effect. vi.resetModules() + a dynamic import
// forces a fresh module instance that re-reads the just-stubbed env,
// rather than weakening the production module into re-reading env vars on
// every call just to make this test convenient.
async function freshGetPlanForOrganization() {
  vi.resetModules();
  const freshModule = await import("./resolve-plan");
  return freshModule.getPlanForOrganization;
}

describe("getPlanForOrganization", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_STARTER_1MONTH", "price_starter_1month");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the free plan when there is no subscription row anywhere", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({ subscription: null, subscriptionV2: null });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("returns the matching paid plan for an active legacy subscription", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "active", stripe_price_id: "price_starter_1month", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-09-01T00:00:00.000Z" },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("starter");
  });

  it("still grants the paid plan while past_due — Stripe's dunning window, not an immediate cutoff", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "past_due", stripe_price_id: "price_starter_1month", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-09-01T00:00:00.000Z" },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("starter");
  });

  it("grants the paid plan while trialing", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "trialing", stripe_price_id: "price_starter_1month", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-09-01T00:00:00.000Z" },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("starter");
  });

  it("falls back to free once Stripe gives up (canceled)", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "canceled", stripe_price_id: "price_starter_1month", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-09-01T00:00:00.000Z" },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("falls back to free for unpaid", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "unpaid", stripe_price_id: "price_starter_1month", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-09-01T00:00:00.000Z" },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("fails closed to free when the subscription's price id isn't a recognized plan", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "active", stripe_price_id: "price_no_longer_configured", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-09-01T00:00:00.000Z" },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("returns the matching paid plan for an active subscriptions_v2 (Razorpay) row when there is no legacy subscription", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscriptionV2: {
        provider: "razorpay",
        internal_plan_id: "growth",
        normalized_status: "active",
        current_period_end: null,
        cancel_at_period_end: false,
        updated_at: "2026-09-01T00:00:00.000Z",
        id: "sub-v2-1",
      },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("growth");
  });

  it("keeps an active legacy Stripe subscriber on their plan even if a non-granting subscriptions_v2 row also exists", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const client = createMockClient({
      subscription: { status: "active", stripe_price_id: "price_starter_1month", current_period_end: null, cancel_at_period_end: false, updated_at: "2026-01-01T00:00:00.000Z" },
      subscriptionV2: {
        provider: "razorpay",
        internal_plan_id: "growth",
        normalized_status: "cancelled",
        current_period_end: null,
        cancel_at_period_end: false,
        updated_at: "2026-09-01T00:00:00.000Z",
        id: "sub-v2-1",
      },
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("starter");
  });
});
