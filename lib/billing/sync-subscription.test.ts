import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Client } from "@/lib/db/shared";
import { syncSubscriptionFromStripe } from "./sync-subscription";

// Per-table mock — same pattern as lib/email/unsubscribe.test.ts and
// lib/db/organizations.test.ts. Each table's chainable resolves to
// `lookupResult` normally, but switches to `writeResult` once .insert()/
// .upsert() is called on it — needed here because
// getBillingCustomer/upsertBillingCustomer and getSubscription/
// upsertSubscription hit the same table with a read then a write in the
// same test, each expecting a different shape (a possibly-null lookup vs.
// a non-null row back from unwrap()).
function createMockClient(tableResults: Record<string, { data?: unknown; error?: unknown }>) {
  const chainablesByTable: Record<string, ReturnType<typeof createChainable>> = {};

  function createChainable(lookupResult: { data?: unknown; error?: unknown }) {
    const writeResult = { data: { id: "written-row" }, error: null };
    let isWrite = false;
    const chainable = {
      select: vi.fn(),
      insert: vi.fn((...args: unknown[]) => {
        void args;
        isWrite = true;
        return chainable;
      }),
      upsert: vi.fn((...args: unknown[]) => {
        void args;
        isWrite = true;
        return chainable;
      }),
      eq: vi.fn(),
      single: vi.fn(),
      maybeSingle: vi.fn(),
      then: (resolve: (value: unknown) => void) => resolve(isWrite ? writeResult : lookupResult),
    };
    for (const method of ["select", "eq", "single", "maybeSingle"] as const) {
      chainable[method].mockReturnValue(chainable);
    }
    return chainable;
  }

  const from = vi.fn((table: string) => {
    if (!chainablesByTable[table]) {
      chainablesByTable[table] = createChainable(tableResults[table] ?? { data: null, error: null });
    }
    return chainablesByTable[table];
  });

  const client = { from } as unknown as Client;
  return { client, chainablesByTable };
}

// Only the fields syncSubscriptionFromStripe actually reads — real Stripe
// objects have dozens more, irrelevant here.
function fakeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    metadata: { organization_id: "org-1" },
    items: {
      data: [
        {
          price: { id: "price_starter_monthly" },
          current_period_end: 1_800_000_000,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("syncSubscriptionFromStripe", () => {
  it("resolves the organization from subscription.metadata and upserts both billing_customers and subscriptions", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: null, error: null },
      subscriptions: { data: { id: "sub-row-1" }, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription());

    expect(chainablesByTable.billing_customers.upsert).toHaveBeenCalledWith(
      { organization_id: "org-1", stripe_customer_id: "cus_123" },
      { onConflict: "organization_id" },
    );
    expect(chainablesByTable.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        stripe_subscription_id: "sub_123",
        stripe_price_id: "price_starter_monthly",
        status: "active",
        cancel_at_period_end: false,
      }),
      { onConflict: "organization_id" },
    );
  });

  it("converts current_period_end from the subscription item (seconds) to an ISO timestamp", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: { stripe_customer_id: "cus_123" }, error: null },
      subscriptions: { data: {}, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription());

    const [values] = chainablesByTable.subscriptions.upsert.mock.calls[0] as [{ current_period_end: string }];
    expect(values.current_period_end).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it("skips writing billing_customers again when the stored customer id already matches", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: { stripe_customer_id: "cus_123" }, error: null },
      subscriptions: { data: {}, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription());

    expect(chainablesByTable.billing_customers.upsert).not.toHaveBeenCalled();
  });

  it("prefers the explicitly passed organizationId over subscription.metadata", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: null, error: null },
      subscriptions: { data: {}, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription({ metadata: {} }), "org-explicit");

    expect(chainablesByTable.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-explicit" }),
      { onConflict: "organization_id" },
    );
  });

  it("falls back to looking up billing_customers by stripe_customer_id when metadata has no organization_id", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: { organization_id: "org-from-customer" }, error: null },
      subscriptions: { data: {}, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription({ metadata: {} }));

    expect(chainablesByTable.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-from-customer" }),
      { onConflict: "organization_id" },
    );
  });

  it("does nothing, doesn't throw, and returns null when no organization can be resolved at all", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: null, error: null },
    });

    await expect(
      syncSubscriptionFromStripe(client, fakeSubscription({ metadata: {} })),
    ).resolves.toBeNull();
    expect(chainablesByTable.subscriptions?.upsert).toBeUndefined();
  });

  it("handles upgrades, downgrades, and renewals identically — all are just 'persist the current price/status'", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: { stripe_customer_id: "cus_123" }, error: null },
      subscriptions: { data: {}, error: null },
    });

    // A downgrade: a different price id, still active.
    await syncSubscriptionFromStripe(
      client,
      fakeSubscription({
        items: { data: [{ price: { id: "price_pro_monthly" }, current_period_end: 1_900_000_000 }] } as never,
      }),
    );

    expect(chainablesByTable.subscriptions.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ stripe_price_id: "price_pro_monthly", status: "active" }),
      { onConflict: "organization_id" },
    );
  });

  it("persists a scheduled cancellation (cancel_at_period_end) without changing status", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: { stripe_customer_id: "cus_123" }, error: null },
      subscriptions: { data: {}, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription({ cancel_at_period_end: true }));

    expect(chainablesByTable.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", cancel_at_period_end: true }),
      { onConflict: "organization_id" },
    );
  });

  it("persists an immediate cancellation as status canceled", async () => {
    const { client, chainablesByTable } = createMockClient({
      billing_customers: { data: { stripe_customer_id: "cus_123" }, error: null },
      subscriptions: { data: {}, error: null },
    });

    await syncSubscriptionFromStripe(client, fakeSubscription({ status: "canceled" }));

    expect(chainablesByTable.subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" }),
      { onConflict: "organization_id" },
    );
  });
});
