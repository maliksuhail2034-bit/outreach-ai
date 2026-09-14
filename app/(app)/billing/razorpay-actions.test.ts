import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocked at the module boundary this Server Function actually imports
// through — same "mock the seam, not the implementation" approach the rest
// of this codebase's tests use. requireUser/createClient are what let this
// run outside a real request (next/headers' cookies() otherwise throws
// outside one); getUserOrganization/getSubscriptionV2/getRazorpayClient are
// mocked so each test can assert exactly what cancelRazorpaySubscriptionAction
// does with a given subscriptions_v2 state, without a real database or a
// real Razorpay account.
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  getUserOrganization: vi.fn(),
}));
vi.mock("@/lib/db/billing-v2", () => ({
  getSubscriptionV2: vi.fn(),
}));
vi.mock("@/lib/billing/razorpay", () => ({
  getRazorpayClient: vi.fn(),
  totalCountForInterval: vi.fn(),
}));

import { requireUser } from "@/lib/supabase/auth";
import { getUserOrganization } from "@/lib/db";
import { getSubscriptionV2 } from "@/lib/db/billing-v2";
import { getRazorpayClient } from "@/lib/billing/razorpay";
import { cancelRazorpaySubscriptionAction } from "./razorpay-actions";

const mockRequireUser = vi.mocked(requireUser);
const mockGetUserOrganization = vi.mocked(getUserOrganization);
const mockGetSubscriptionV2 = vi.mocked(getSubscriptionV2);
const mockGetRazorpayClient = vi.mocked(getRazorpayClient);

const USER = { id: "user-1", email: "owner@example.com" };
const ORGANIZATION = { id: "org-1" };

function mockCancel(impl: (...args: unknown[]) => unknown) {
  const cancel = vi.fn(impl);
  mockGetRazorpayClient.mockReturnValue({
    subscriptions: { cancel },
  } as unknown as ReturnType<typeof getRazorpayClient>);
  return cancel;
}

function razorpaySubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-row-1",
    organization_id: ORGANIZATION.id,
    provider: "razorpay",
    provider_subscription_id: "sub_real_razorpay_id",
    normalized_status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unauthenticated is the default per requireUser's own contract (throws
  // when there's no session) — every test that needs a signed-in user
  // opts in explicitly via mockRequireUser.mockResolvedValue(USER).
  mockRequireUser.mockRejectedValue(new Error("Unauthorized: no authenticated user."));
  mockGetUserOrganization.mockResolvedValue(ORGANIZATION as never);
});

describe("cancelRazorpaySubscriptionAction", () => {
  it("cancels a real, active Razorpay subscription for the caller's own organization", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription() as never);
    const cancel = mockCancel(async () => ({ id: "sub_real_razorpay_id", status: "cancelled" }));

    await expect(cancelRazorpaySubscriptionAction()).resolves.toBeUndefined();

    // Correct subscription id, and cancelAtCycleEnd=false (immediate) —
    // never the scheduled-cancellation variant this app doesn't support
    // (see the action's own comment on why).
    expect(cancel).toHaveBeenCalledWith("sub_real_razorpay_id", false);
    // Scoped to the caller's own organization, never a hardcoded/guessed id.
    expect(mockGetSubscriptionV2).toHaveBeenCalledWith(expect.anything(), ORGANIZATION.id);
  });

  it("rejects an unauthenticated caller before touching the database or Razorpay", async () => {
    // requireUser rejects by default (see beforeEach) — this is the case.
    const cancel = mockCancel(async () => ({}));

    await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow();

    expect(mockGetSubscriptionV2).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the authenticated caller's own organization, never another org's", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    const otherOrg = { id: "org-belonging-to-someone-else" };
    mockGetUserOrganization.mockResolvedValue(otherOrg as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ organization_id: otherOrg.id }) as never);
    mockCancel(async () => ({}));

    await cancelRazorpaySubscriptionAction();

    // getUserOrganization derives the org from the authenticated session
    // alone (see lib/db/organizations.ts) — there is no organization id
    // parameter anywhere on this action for an attacker to substitute, so
    // the only thing to verify is that whatever getUserOrganization
    // resolves is exactly what gets queried, never a different value.
    expect(mockGetSubscriptionV2).toHaveBeenCalledWith(expect.anything(), otherOrg.id);
  });

  it("rejects a free user with no subscriptions_v2 row at all", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(null as never);
    const cancel = mockCancel(async () => ({}));

    await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow(/no active razorpay subscription/i);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects a subscriber whose current subscription is on a different provider", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ provider: "stripe" }) as never);
    const cancel = mockCancel(async () => ({}));

    await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow(/no active razorpay subscription/i);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects a duplicate cancellation attempt on an already-cancelled subscription without calling Razorpay again", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ normalized_status: "cancelled" }) as never);
    const cancel = mockCancel(async () => ({}));

    await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow(/already cancelled or inactive/i);

    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(["expired", "completed", "suspended"])(
    "rejects cancelling a subscription that's already in a terminal '%s' state",
    async (normalizedStatus) => {
      mockRequireUser.mockResolvedValue(USER as never);
      mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ normalized_status: normalizedStatus }) as never);
      const cancel = mockCancel(async () => ({}));

      await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow(/already cancelled or inactive/i);

      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it("sanitizes a raw Razorpay API failure into a generic message, never leaking it to the caller", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription() as never);
    mockCancel(async () => {
      throw new Error("Razorpay 401: invalid key_secret for account acct_super_secret");
    });

    await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow(
      "Couldn't cancel the subscription. Try again shortly or contact support.",
    );
  });
});
