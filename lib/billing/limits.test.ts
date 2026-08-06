import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import {
  assertWithinCampaignLimit,
  assertWithinDailySendLimit,
  assertWithinLeadLimit,
  assertWithinMailboxLimit,
  getRemainingLeadQuota,
  PlanLimitError,
} from "./limits";

// Per-table queued-result mock — same pattern as lib/db/organizations.test.ts's
// createMultiTableMockClient. A membership row is always present (org-1) so
// every test exercises the "existing organization" branch of
// getOrCreateOrganizationForUser, not its create-a-new-org path (already
// covered by lib/db/organizations.test.ts).
function createMockClient(overrides: {
  subscription?: { status: string; stripe_price_id: string } | null;
  countResult?: { count: number };
  campaigns?: { id: string; daily_limit: number }[];
}) {
  const membership = { organization_id: "org-1", user_id: "user-1" };
  const organization = { id: "org-1", owner_user_id: "user-1", name: "Test workspace" };

  const tableResults: Record<string, { data?: unknown; error?: unknown; count?: number }> = {
    organization_members: { data: membership, error: null },
    organizations: { data: organization, error: null },
    subscriptions: { data: overrides.subscription ?? null, error: null },
    mailboxes: { count: overrides.countResult?.count ?? 0, error: null, data: null },
    campaigns: overrides.campaigns
      ? { data: overrides.campaigns, error: null }
      : { count: overrides.countResult?.count ?? 0, error: null, data: null },
    leads: { count: overrides.countResult?.count ?? 0, error: null, data: null },
  };

  function createChainable(table: string) {
    const result = tableResults[table] ?? { data: null, error: null };
    const chainable = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      single: vi.fn(),
      maybeSingle: vi.fn(),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    for (const method of ["select", "eq", "order", "limit", "single", "maybeSingle"] as const) {
      chainable[method].mockReturnValue(chainable);
    }
    return chainable;
  }

  const chainablesByTable: Record<string, ReturnType<typeof createChainable>> = {};
  const from = vi.fn((table: string) => {
    if (!chainablesByTable[table]) chainablesByTable[table] = createChainable(table);
    return chainablesByTable[table];
  });

  const client = { from } as unknown as Client;
  return { client };
}

describe("assertWithinMailboxLimit", () => {
  beforeEach(() => vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", "price_starter_monthly"));
  afterEach(() => vi.unstubAllEnvs());

  it("allows creating a mailbox when under the free plan's limit", async () => {
    const { client } = createMockClient({ countResult: { count: 0 } });
    await expect(assertWithinMailboxLimit(client, "user-1", "user@example.com")).resolves.toBeUndefined();
  });

  it("throws PlanLimitError once the free plan's mailbox limit is reached", async () => {
    const { client } = createMockClient({ countResult: { count: 1 } }); // free plan allows 1
    await expect(assertWithinMailboxLimit(client, "user-1", "user@example.com")).rejects.toThrow(PlanLimitError);
  });

  it("allows more mailboxes on a paid plan with a higher limit", async () => {
    // PLANS (lib/billing/plans.ts) reads its Stripe price ids from
    // process.env once, at module load — stubbing the env var here has no
    // effect on the already-imported module's frozen PLANS.starter, so
    // this needs a fresh module instance via resetModules + dynamic
    // import, same as lib/billing/resolve-plan.test.ts.
    vi.resetModules();
    const { assertWithinMailboxLimit: freshAssert } = await import("./limits");
    const { client } = createMockClient({
      subscription: { status: "active", stripe_price_id: "price_starter_monthly" },
      countResult: { count: 1 }, // over the free limit, under starter's
    });
    await expect(freshAssert(client, "user-1", "user@example.com")).resolves.toBeUndefined();
  });
});

describe("assertWithinCampaignLimit", () => {
  it("throws once the free plan's campaign limit is reached", async () => {
    const { client } = createMockClient({ countResult: { count: 1 } }); // free plan allows 1
    await expect(assertWithinCampaignLimit(client, "user-1", "user@example.com")).rejects.toThrow(PlanLimitError);
  });
});

describe("assertWithinLeadLimit", () => {
  it("throws once the free plan's lead limit is reached", async () => {
    const { client } = createMockClient({ countResult: { count: 200 } }); // free plan allows 200
    await expect(assertWithinLeadLimit(client, "user-1", "user@example.com")).rejects.toThrow(PlanLimitError);
  });

  it("allows adding a lead under the limit", async () => {
    const { client } = createMockClient({ countResult: { count: 199 } });
    await expect(assertWithinLeadLimit(client, "user-1", "user@example.com")).resolves.toBeUndefined();
  });
});

describe("getRemainingLeadQuota", () => {
  it("returns how many more leads can be added on the free plan", async () => {
    const { client } = createMockClient({ countResult: { count: 150 } });
    expect(await getRemainingLeadQuota(client, "user-1", "user@example.com")).toBe(50); // 200 - 150
  });

  it("never goes negative when already over the limit", async () => {
    const { client } = createMockClient({ countResult: { count: 250 } });
    expect(await getRemainingLeadQuota(client, "user-1", "user@example.com")).toBe(0);
  });

  it("returns Infinity for an unlimited plan", async () => {
    // See the resetModules comment above — PLANS reads env vars at module
    // load, so a fresh import is needed after stubbing.
    vi.stubEnv("STRIPE_PRICE_AGENCY_MONTHLY", "price_agency_monthly");
    vi.resetModules();
    const { getRemainingLeadQuota: freshGetRemainingLeadQuota } = await import("./limits");
    const { client } = createMockClient({
      subscription: { status: "active", stripe_price_id: "price_agency_monthly" },
      countResult: { count: 999999 },
    });
    expect(await freshGetRemainingLeadQuota(client, "user-1", "user@example.com")).toBe(Infinity);
    vi.unstubAllEnvs();
  });
});

describe("assertWithinDailySendLimit", () => {
  it("allows a new campaign whose daily_limit fits under the free plan's total cap", async () => {
    const { client } = createMockClient({ campaigns: [{ id: "c-1", daily_limit: 20 }] }); // free cap is 50
    await expect(assertWithinDailySendLimit(client, "user-1", "user@example.com", 20)).resolves.toBeUndefined();
  });

  it("throws when adding the new campaign's daily_limit would exceed the plan's total cap", async () => {
    const { client } = createMockClient({ campaigns: [{ id: "c-1", daily_limit: 40 }] }); // free cap is 50
    await expect(assertWithinDailySendLimit(client, "user-1", "user@example.com", 20)).rejects.toThrow(
      PlanLimitError,
    );
  });

  it("excludes the campaign being edited from its own total, so raising its own limit isn't double-counted", async () => {
    const { client } = createMockClient({ campaigns: [{ id: "c-1", daily_limit: 40 }] }); // free cap is 50
    // Editing c-1 itself up to 45 should not count the old 40 against the new 45.
    await expect(
      assertWithinDailySendLimit(client, "user-1", "user@example.com", 45, "c-1"),
    ).resolves.toBeUndefined();
  });
});
