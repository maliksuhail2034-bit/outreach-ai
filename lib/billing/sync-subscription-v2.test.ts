import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import {
  syncSubscriptionFromRazorpay,
  toRazorpayPlanEntity,
  toRazorpaySubscriptionEntity,
  type RazorpayPlanEntity,
  type RazorpaySubscriptionEntity,
} from "./sync-subscription-v2";
import { getPlanOffering } from "./offerings";
import type { BillingInterval, PaidPlanId } from "./plans";
import type { Currency } from "./currency";

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

const MONTHS: Record<BillingInterval, number> = { "1_month": 1, "3_month": 3, "6_month": 6, "12_month": 12 };

// The Razorpay plan a correctly created subscription would be on: the one
// whose currency, amount and cycle match what its notes say was bought.
// Notes without a currency (created before USD support) are INR. Notes the
// sync rejects as unmapped get a placeholder plan it never reaches.
function matchingPlan(subscription: RazorpaySubscriptionEntity, overrides: Partial<RazorpayPlanEntity> = {}): RazorpayPlanEntity {
  const notes = subscription.notes ?? {};
  const planId = (["starter", "growth", "pro", "scale"].includes(String(notes.internal_plan_id)) ? notes.internal_plan_id : "starter") as PaidPlanId;
  const interval = (String(notes.billing_interval) in MONTHS ? notes.billing_interval : "1_month") as BillingInterval;
  const currency = (notes.currency ?? "INR") as Currency;
  return {
    id: subscription.plan_id,
    period: "monthly",
    interval: MONTHS[interval],
    amount: getPlanOffering(planId, interval, currency).amount,
    currency,
    ...overrides,
  };
}

function sync(client: Client, subscription: RazorpaySubscriptionEntity, plan: RazorpayPlanEntity = matchingPlan(subscription)) {
  return syncSubscriptionFromRazorpay(client, subscription, plan);
}

describe("syncSubscriptionFromRazorpay", () => {
  it("upserts both billing_customers_v2 and subscriptions_v2, and returns the resolved organization id", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const result = await sync(client, fakeSubscription());

    expect(result).toEqual({ outcome: "synced", organizationId: "org-1", currency: "INR", unrecognizedStatus: false });
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

  describe("currency", () => {
    it("persists INR for a subscription on an INR plan", async () => {
      const { client, upsertCallsByTable } = createMockClient();
      const subscription = fakeSubscription({
        notes: { organization_id: "org-1", internal_plan_id: "pro", billing_interval: "3_month", currency: "INR" },
      });

      const result = await sync(client, subscription);

      expect(result).toMatchObject({ outcome: "synced", currency: "INR" });
      expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({
        currency: "INR",
        internal_plan_id: "pro",
        billing_interval: "3_month",
      });
    });

    it("persists USD for a subscription on a USD plan, with plan, interval and ids consistent", async () => {
      const { client, upsertCallsByTable } = createMockClient();
      const subscription = fakeSubscription({
        plan_id: "plan_usd_scale_12m",
        notes: { organization_id: "org-1", internal_plan_id: "scale", billing_interval: "12_month", currency: "USD" },
      });

      const result = await sync(client, subscription);

      expect(result).toMatchObject({ outcome: "synced", currency: "USD" });
      expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({
        currency: "USD",
        internal_plan_id: "scale",
        billing_interval: "12_month",
        provider_plan_id: "plan_usd_scale_12m",
        provider_subscription_id: "sub_test_123",
      });
    });

    it("treats a subscription with no currency note (created before USD support) as its plan's currency", async () => {
      const { client, upsertCallsByTable } = createMockClient();

      await sync(client, fakeSubscription());

      expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({ currency: "INR" });
    });

    it("accepts a 12-month plan set up in Razorpay as yearly × 1", async () => {
      const { client } = createMockClient();
      const subscription = fakeSubscription({
        notes: { organization_id: "org-1", internal_plan_id: "growth", billing_interval: "12_month", currency: "USD" },
      });

      const result = await sync(client, subscription, matchingPlan(subscription, { period: "yearly", interval: 1 }));

      expect(result).toMatchObject({ outcome: "synced", currency: "USD" });
    });
  });

  // The notes are written by the checkout action; the plan is what Razorpay
  // actually charges. They must agree before anything is written.
  describe("plan mismatch", () => {
    const usdStarter = () =>
      fakeSubscription({
        notes: { organization_id: "org-1", internal_plan_id: "starter", billing_interval: "1_month", currency: "USD" },
      });
    const inrStarter = () => fakeSubscription();

    it.each([
      {
        label: "notes say USD but the plan charges INR",
        subscription: usdStarter,
        plan: (s: RazorpaySubscriptionEntity) => matchingPlan(s, { currency: "INR", amount: 115_200 }),
        reason: /notes currency USD does not match plan currency INR/,
      },
      {
        label: "notes say INR but the plan charges USD",
        subscription: () =>
          fakeSubscription({
            notes: { organization_id: "org-1", internal_plan_id: "starter", billing_interval: "1_month", currency: "INR" },
          }),
        plan: (s: RazorpaySubscriptionEntity) => matchingPlan(s, { currency: "USD", amount: 1_200 }),
        reason: /notes currency INR does not match plan currency USD/,
      },
      {
        label: "the plan's amount isn't this plan's price",
        subscription: usdStarter,
        plan: (s: RazorpaySubscriptionEntity) => matchingPlan(s, { amount: 2_200 }),
        reason: /plan amount 2200 USD/,
      },
      {
        label: "the plan's cycle isn't the noted interval",
        subscription: inrStarter,
        plan: (s: RazorpaySubscriptionEntity) => matchingPlan(s, { interval: 3 }),
        reason: /plan cycle 3 monthly/,
      },
      {
        label: "the plan is in an unsupported currency",
        subscription: inrStarter,
        plan: (s: RazorpaySubscriptionEntity) => matchingPlan(s, { currency: "EUR" }),
        reason: /EUR is not supported/,
      },
      {
        label: "the fetched plan isn't the subscription's plan",
        subscription: inrStarter,
        plan: (s: RazorpaySubscriptionEntity) => matchingPlan(s, { id: "plan_other" }),
        reason: /not the subscription's plan/,
      },
    ])("rejects and writes nothing when $label", async ({ subscription, plan, reason }) => {
      const { client, upsertCallsByTable } = createMockClient();
      const sub = subscription();

      const result = await sync(client, sub, plan(sub));

      expect(result).toMatchObject({ outcome: "plan_mismatch", organizationId: "org-1" });
      expect((result as { reason: string }).reason).toMatch(reason);
      expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
      expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    });

    it("rejects notes claiming a higher plan than the Razorpay plan being paid for", async () => {
      const { client, upsertCallsByTable } = createMockClient();
      // Paying the Starter price; notes claim Scale.
      const subscription = fakeSubscription({
        notes: { organization_id: "org-1", internal_plan_id: "scale", billing_interval: "1_month", currency: "INR" },
      });

      const result = await sync(
        client,
        subscription,
        matchingPlan(subscription, { amount: getPlanOffering("starter", "1_month", "INR").amount }),
      );

      expect(result).toMatchObject({ outcome: "plan_mismatch" });
      expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
    });
  });

  it("converts current_start/current_end from unix seconds to ISO timestamps", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await sync(client, fakeSubscription());

    const values = upsertCallsByTable.subscriptions_v2[0][0] as {
      current_period_start: string;
      current_period_end: string;
    };
    expect(values.current_period_start).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(values.current_period_end).toBe(new Date(1_802_592_000 * 1000).toISOString());
  });

  it("stores null period bounds when current_start/current_end are absent", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await sync(client, fakeSubscription({ current_start: null, current_end: null }));

    const values = upsertCallsByTable.subscriptions_v2[0][0] as {
      current_period_start: string | null;
      current_period_end: string | null;
    };
    expect(values.current_period_start).toBeNull();
    expect(values.current_period_end).toBeNull();
  });

  it("skips the billing_customers_v2 upsert when the subscription has no customer_id yet", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await sync(client, fakeSubscription({ customer_id: null }));

    expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    expect(upsertCallsByTable.subscriptions_v2).toBeDefined();
  });

  it("normalizes provider_status through the shared Razorpay status map (e.g. halted -> suspended)", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await sync(client, fakeSubscription({ status: "halted" }));

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

    const result = await sync(client, fakeSubscription({ notes }));

    expect(result).toEqual({ outcome: "unmapped" });
    expect(upsertCallsByTable.billing_customers_v2).toBeUndefined();
    expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
  });

  it("returns unmapped and writes nothing when notes are entirely absent", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const result = await sync(client, fakeSubscription({ notes: null }));

    expect(result).toEqual({ outcome: "unmapped" });
    expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
  });

  it("always writes cancel_at_period_end as false — Razorpay's entity has no persistent field for it", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    await sync(client, fakeSubscription({ status: "cancelled" }));

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

      const result = await sync(client, fakeSubscription({ status: "halted" }));

      expect(result).toMatchObject({ outcome: "synced", organizationId: "org-1" });
      expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({ provider_subscription_id: "sub_test_123", normalized_status: "suspended" });
    });

    it("does not let an old, ended subscription overwrite a different live one", async () => {
      const { client, upsertCallsByTable } = createMockClient({ current: currentRow() });

      const result = await sync(client, fakeSubscription({ status: "cancelled" }));

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

        const result = await sync(client, fakeSubscription({ status: "active" }));

        expect(result).toMatchObject({ outcome: "skipped_other_current_subscription", incomingNonTerminal: true });
        expect(upsertCallsByTable.subscriptions_v2).toBeUndefined();
      },
    );

    it.each(["cancelled", "suspended", "expired", "completed"])(
      "replaces an ended (%s) subscription with a new one — resubscribing after cancellation",
      async (currentStatus) => {
        const { client, upsertCallsByTable } = createMockClient({ current: currentRow({ normalized_status: currentStatus }) });

        const result = await sync(client, fakeSubscription({ status: "active" }));

        expect(result).toMatchObject({ outcome: "synced" });
        expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({ provider_subscription_id: "sub_test_123", normalized_status: "active" });
      },
    );
  });

  it("stores an unrecognized provider status as suspended and reports it", async () => {
    const { client, upsertCallsByTable } = createMockClient();

    const result = await sync(client, fakeSubscription({ status: "some_future_status" }));

    expect(result).toEqual({ outcome: "synced", organizationId: "org-1", currency: "INR", unrecognizedStatus: true });
    expect(upsertCallsByTable.subscriptions_v2[0][0]).toMatchObject({
      provider_status: "some_future_status",
      normalized_status: "suspended",
    });
  });

  it("throws when the database write fails, so the webhook can return 500 and be retried", async () => {
    const { client } = createMockClient({ upsertError: { message: "connection reset" } });

    await expect(sync(client, fakeSubscription())).rejects.toBeTruthy();
  });
});

describe("toRazorpayPlanEntity", () => {
  it("keeps the plan's cycle, amount and currency, reading a string amount as a number", () => {
    const entity = toRazorpayPlanEntity({
      id: "plan_1",
      entity: "plan",
      period: "monthly",
      interval: 3,
      item: { amount: "328320", currency: "INR", name: "Starter 3 months" },
    } as unknown as Parameters<typeof toRazorpayPlanEntity>[0]);

    expect(entity).toEqual({ id: "plan_1", period: "monthly", interval: 3, amount: 328_320, currency: "INR" });
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
