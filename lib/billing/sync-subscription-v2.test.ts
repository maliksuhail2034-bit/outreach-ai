import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import { syncSubscriptionFromRazorpay, type RazorpaySubscriptionEntity } from "./sync-subscription-v2";

// Per-table mock mirroring lib/billing/sync-subscription.test.ts's own
// pattern, adapted to billing-v2.ts's actual chain shape:
// .from(table).upsert(values, opts).select("*").single(). Each table
// records every upsert() call so tests can assert on exactly what was
// written, without needing a real database.
function createMockClient() {
  const upsertCallsByTable: Record<string, unknown[][]> = {};

  function createChainable(table: string) {
    const chainable = {
      upsert: vi.fn((...args: unknown[]) => {
        (upsertCallsByTable[table] ??= []).push(args);
        return chainable;
      }),
      select: vi.fn(() => chainable),
      single: vi.fn(() => Promise.resolve({ data: { id: `${table}-row` }, error: null })),
    };
    return chainable;
  }

  const chainablesByTable: Record<string, ReturnType<typeof createChainable>> = {};
  const from = vi.fn((table: string) => {
    if (!chainablesByTable[table]) chainablesByTable[table] = createChainable(table);
    return chainablesByTable[table];
  });

  const client = { from } as unknown as Client;
  return { client, upsertCallsByTable };
}

// Only the fields syncSubscriptionFromRazorpay actually reads.
function fakeSubscription(overrides: Partial<RazorpaySubscriptionEntity> = {}): RazorpaySubscriptionEntity {
  return {
    id: "sub_test_123",
    plan_id: "plan_test_starter_1m",
    customer_id: "cust_test_123",
    status: "active",
    current_start: 1_800_000_000,
    current_end: 1_802_592_000,
    notes: {
      organization_id: "org-1",
      internal_plan_id: "starter",
      billing_interval: "1_month",
    },
    ...overrides,
  };
}

describe("syncSubscriptionFromRazorpay", () => {
  it("upserts both billing_customers_v2 and subscriptions_v2, and returns the resolved organization id", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const organizationId = await syncSubscriptionFromRazorpay(client, fakeSubscription());

    expect(organizationId).toBe("org-1");
    expect(upsertCallsByTable.billing_customers_v2[0][0]).toEqual({
      organization_id: "org-1",
      provider: "razorpay",
      provider_customer_id: "cust_test_123",
    });
    expect(upsertCallsByTable.subscriptions_v2[0][0]).toEqual(
      expect.objectContaining({
        organization_id: "org-1",
        provider: "razorpay",
        provider_subscription_id: "sub_test_123",
        provider_plan_id: "plan_test_starter_1m",
        internal_plan_id: "starter",
        billing_interval: "1_month",
        provider_status: "active",
        normalized_status: "active",
        cancel_at_period_end: false,
      }),
    );
  });

  it("converts current_start/current_end from unix seconds to ISO timestamps", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await syncSubscriptionFromRazorpay(client, fakeSubscription());

    const values = upsertCallsByTable.subscriptions_v2[0][0] as {
      current_period_start: string;
      current_period_end: string;
    };
    expect(values.current_period_start).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(values.current_period_end).toBe(new Date(1_802_592_000 * 1000).toISOString());
  });

  it("stores null period bounds when current_start/current_end are absent", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await syncSubscriptionFromRazorpay(client, fakeSubscription({ current_start: null, current_end: null }));

    const values = upsertCallsByTable.subscriptions_v2[0][0] as {
      current_period_start: string | null;
      current_period_end: string | null;
    };
    expect(values.current_period_start).toBeNull();
    expect(values.current_period_end).toBeNull();
  });

  it("skips the billing_customers_v2 upsert when the subscription has no customer_id yet", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await syncSubscriptionFromRazorpay(client, fakeSubscription({ customer_id: null }));

    expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    expect(upsertCallsByTable.subscriptions_v2).toBeDefined();
  });

  it("normalizes provider_status through the shared Razorpay status map (e.g. halted -> suspended)", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "halted" }));

    const values = upsertCallsByTable.subscriptions_v2[0][0] as { provider_status: string; normalized_status: string };
    expect(values.provider_status).toBe("halted");
    expect(values.normalized_status).toBe("suspended");
  });

  it.each([
    ["missing organization_id", { internal_plan_id: "starter", billing_interval: "1_month" }],
    ["missing internal_plan_id", { organization_id: "org-1", billing_interval: "1_month" }],
    [
      "unrecognized internal_plan_id",
      { organization_id: "org-1", internal_plan_id: "not_a_real_plan", billing_interval: "1_month" },
    ],
    ["missing billing_interval", { organization_id: "org-1", internal_plan_id: "starter" }],
    [
      "unrecognized billing_interval",
      { organization_id: "org-1", internal_plan_id: "starter", billing_interval: "2_month" },
    ],
  ])("returns null and writes nothing when notes have %s", async (_label, notes) => {
    const { client, upsertCallsByTable } = createMockClient();

    const organizationId = await syncSubscriptionFromRazorpay(client, fakeSubscription({ notes }));

    expect(organizationId).toBeNull();
    expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
  });

  it("returns null and writes nothing when notes are entirely absent", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const organizationId = await syncSubscriptionFromRazorpay(client, fakeSubscription({ notes: null }));

    expect(organizationId).toBeNull();
    expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
  });

  it("always writes cancel_at_period_end as false — Razorpay's entity has no persistent field for it", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "cancelled" }));

    const values = upsertCallsByTable.subscriptions_v2[0][0] as { cancel_at_period_end: boolean };
    expect(values.cancel_at_period_end).toBe(false);
  });
});
