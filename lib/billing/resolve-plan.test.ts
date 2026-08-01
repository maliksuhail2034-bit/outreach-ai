import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";

function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "eq", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }
  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client };
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
    vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", "price_starter_monthly");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the free plan when there is no subscription row", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const { client } = createMockClient({ data: null, error: null });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("returns the matching paid plan for an active subscription", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const { client } = createMockClient({
      data: { status: "active", stripe_price_id: "price_starter_monthly" },
      error: null,
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("starter");
  });

  it("still grants the paid plan while past_due — Stripe's dunning window, not an immediate cutoff", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const { client } = createMockClient({
      data: { status: "past_due", stripe_price_id: "price_starter_monthly" },
      error: null,
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("starter");
  });

  it("falls back to free once Stripe gives up (canceled)", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const { client } = createMockClient({
      data: { status: "canceled", stripe_price_id: "price_starter_monthly" },
      error: null,
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("falls back to free for unpaid", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const { client } = createMockClient({
      data: { status: "unpaid", stripe_price_id: "price_starter_monthly" },
      error: null,
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });

  it("fails closed to free when the subscription's price id isn't a recognized plan", async () => {
    const getPlanForOrganization = await freshGetPlanForOrganization();
    const { client } = createMockClient({
      data: { status: "active", stripe_price_id: "price_no_longer_configured" },
      error: null,
    });
    const plan = await getPlanForOrganization(client, "org-1");
    expect(plan.id).toBe("free");
  });
});
