import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import { syncSubscriptionFromRazorpay, toRazorpaySubscriptionEntity, type RazorpaySubscriptionEntity } from "./sync-subscription-v2";

// Per-table mock mirroring lib/billing/sync-subscription.test.ts's own
// pattern, adapted to billing-v2.ts's actual chain shape:
// .from(table).upsert(values, opts).select("*").single(). Each table
// records every upsert() call so tests can assert on exactly what was
// written, without needing a real database.
// `current` is what getSubscriptionV2's read (.select().eq().maybeSingle())
// returns for subscriptions_v2 — the organization's existing row, if any.
// `upsertError` makes every upsert's .single() resolve with a database
// error, the way a real constraint/connection failure surfaces.
function createMockClient(options: { current?: Record<string, unknown> | null; upsertError?: { message: string } } = {}) {
  const upsertCallsByTable: Record<string, unknown[][]> = {};

  function createChainable(table: string) {
    const chainable = {
      upsert: vi.fn((...args: unknown[]) => {
        (upsertCallsByTable[table] ??= []).push(args);
        return chainable;
      }),
      select: vi.fn(() => chainable),
      eq: vi.fn(() => chainable),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: table === "subscriptions_v2" ? (options.current ?? null) : null, error: null }),
      ),
      single: vi.fn(() =>
        Promise.resolve(
          options.upsertError ? { data: null, error: options.upsertError } : { data: { id: `${table}-row` }, error: null },
        ),
      ),
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

    const result = await syncSubscriptionFromRazorpay(client, fakeSubscription());

    expect(result).toEqual({ outcome: "synced", organizationId: "org-1", unrecognizedStatus: false });
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
        currency: "INR",
        provider_status: "active",
        normalized_status: "active",
        cancel_at_period_end: false,
      }),
    );
  });

  it("always persists currency as INR — this sync path is exclusively the Razorpay India payment route", async () => {
    // Not inferred from the webhook payload, notes, or any other input —
    // Razorpay's Indian payment rails (UPI/Indian cards/netbanking) cannot
    // charge anything but INR, so this is hardcoded at the source
    // (lib/billing/currency.ts's ROUTE_CURRENCY.razorpay_india), same as
    // `provider: "razorpay"` already is. Exercised across several distinct
    // statuses/plans to confirm nothing about the specific subscription
    // ever changes the persisted currency.
    for (const overrides of [
      {},
      { status: "halted" },
      { notes: { organization_id: "org-2", internal_plan_id: "scale", billing_interval: "12_month" } },
    ] as const) {
      const { client, upsertCallsByTable } = createMockClient();
      await syncSubscriptionFromRazorpay(client, fakeSubscription(overrides));
      const values = upsertCallsByTable.subscriptions_v2[0][0] as { currency: string };
      expect(values.currency).toBe("INR");
    }
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
  ])("returns unmapped and writes nothing when notes have %s", async (_label, notes) => {
    const { client, upsertCallsByTable } = createMockClient();

    const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ notes }));

    expect(result).toEqual({ outcome: "unmapped" });
    expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
  });

  it("returns unmapped and writes nothing when notes are entirely absent", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ notes: null }));

    expect(result).toEqual({ outcome: "unmapped" });
    expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
  });

  it("always writes cancel_at_period_end as false — Razorpay's entity has no persistent field for it", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "cancelled" }));

    const values = upsertCallsByTable.subscriptions_v2[0][0] as { cancel_at_period_end: boolean };
    expect(values.cancel_at_period_end).toBe(false);
  });

  // subscriptions_v2 has one row per organization, so writing a different
  // subscription replaces the current one — only allowed once the current
  // one has ended.
  describe("the organization's current subscription", () => {
    function currentRow(overrides: Record<string, unknown> = {}) {
      return {
        provider: "razorpay",
        provider_subscription_id: "sub_current_999",
        normalized_status: "active",
        ...overrides,
      };
    }

    it("updates the row when the event is for the same subscription", async () => {
      const { client, upsertCallsByTable } = createMockClient({ current: currentRow({ provider_subscription_id: "sub_test_123" }) });

      const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "halted" }));

      expect(result).toMatchObject({ outcome: "synced", organizationId: "org-1" });
      expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({ provider_subscription_id: "sub_test_123", normalized_status: "suspended" });
    });

    it("does not let an old, ended subscription overwrite a different live one", async () => {
      const { client, upsertCallsByTable } = createMockClient({ current: currentRow() });

      const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "cancelled" }));

      expect(result).toEqual({
        outcome: "skipped_other_current_subscription",
        organizationId: "org-1",
        currentSubscriptionId: "sub_current_999",
        incomingNonTerminal: false,
      });
      expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
      expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    });

    it.each(["active", "past_due", "pending"])(
      "does not overwrite a live (%s) subscription with a second live one, and flags it as live",
      async (currentStatus) => {
        const { client, upsertCallsByTable } = createMockClient({ current: currentRow({ normalized_status: currentStatus }) });

        const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "active" }));

        expect(result).toMatchObject({ outcome: "skipped_other_current_subscription", incomingNonTerminal: true });
        expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
      },
    );

    it.each(["cancelled", "suspended", "expired", "completed"])(
      "replaces an ended (%s) subscription with a new one — resubscribing after cancellation",
      async (currentStatus) => {
        const { client, upsertCallsByTable } = createMockClient({ current: currentRow({ normalized_status: currentStatus }) });

        const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "active" }));

        expect(result).toMatchObject({ outcome: "synced" });
        expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({ provider_subscription_id: "sub_test_123", normalized_status: "active" });
      },
    );
  });

  it("stores an unrecognized provider status as suspended and reports it", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const result = await syncSubscriptionFromRazorpay(client, fakeSubscription({ status: "some_future_status" }));

    expect(result).toEqual({ outcome: "synced", organizationId: "org-1", unrecognizedStatus: true });
    expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({
      provider_status: "some_future_status",
      normalized_status: "suspended",
    });
  });

  it("throws when the database write fails, so the webhook can return 500 and be retried", async () => {
    const { client } = createMockClient({ upsertError: { message: "connection reset" } });

    await expect(syncSubscriptionFromRazorpay(client, fakeSubscription())).rejects.toBeTruthy();
  });
});

describe("toRazorpaySubscriptionEntity", () => {
  it("keeps only the fields the sync reads, defaulting missing optional ones to null", () => {
    const entity = toRazorpaySubscriptionEntity({
      id: "sub_1",
      entity: "subscription",
      plan_id: "plan_1",
      customer_id: null,
      status: "active",
      notes: { organization_id: "org-1" },
      total_count: 12,
    } as unknown as Parameters<typeof toRazorpaySubscriptionEntity>[0]);

    expect(entity).toEqual({
      id: "sub_1",
      plan_id: "plan_1",
      customer_id: null,
      status: "active",
      current_start: null,
      current_end: null,
      notes: { organization_id: "org-1" },
    });
  });
});
