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
vi.mock("@/lib/billing/subscription-view", () => ({
  getActiveSubscriptionView: vi.fn(),
}));
vi.mock("@/lib/billing/razorpay", () => ({
  getRazorpayClient: vi.fn(),
  totalCountForInterval: vi.fn(),
}));
vi.mock("@/lib/billing/plans", () => ({
  getRazorpayPlanId: vi.fn(),
  // Real value, not mocked — lib/validations/billing.ts's checkoutSchema
  // (imported transitively by razorpay-actions.ts) builds a real z.enum()
  // from this at module-load time, so it must stay a real, non-empty array
  // for that import to succeed at all, independent of what any individual
  // test needs from it.
  PAID_PLAN_IDS: ["starter", "growth", "pro", "scale"],
}));
vi.mock("@/lib/rate-limit/check-rate-limit", () => ({
  checkRateLimit: vi.fn(),
  RateLimitError: class RateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super(`Too many attempts. Try again in ${retryAfterSeconds}s.`);
      this.name = "RateLimitError";
    }
  },
}));

import { requireUser } from "@/lib/supabase/auth";
import { getUserOrganization } from "@/lib/db";
import { getSubscriptionV2 } from "@/lib/db/billing-v2";
import { getRazorpayClient } from "@/lib/billing/razorpay";
import { getRazorpayPlanId } from "@/lib/billing/plans";
import { getActiveSubscriptionView } from "@/lib/billing/subscription-view";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import {
  cancelRazorpaySubscriptionAction,
  createRazorpaySubscriptionAction,
  getRazorpayCheckoutStatusAction,
} from "./razorpay-actions";

const mockRequireUser = vi.mocked(requireUser);
const mockGetUserOrganization = vi.mocked(getUserOrganization);
const mockGetSubscriptionV2 = vi.mocked(getSubscriptionV2);
const mockGetRazorpayClient = vi.mocked(getRazorpayClient);
const mockGetRazorpayPlanId = vi.mocked(getRazorpayPlanId);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockGetActiveSubscriptionView = vi.mocked(getActiveSubscriptionView);

const USER = { id: "user-1", email: "owner@example.com" };
const ORGANIZATION = { id: "org-1" };

function mockCancel(impl: (...args: unknown[]) => unknown) {
  const cancel = vi.fn(impl);
  mockGetRazorpayClient.mockReturnValue({
    subscriptions: { cancel },
  } as unknown as ReturnType<typeof getRazorpayClient>);
  return cancel;
}

function mockCreate(impl: (...args: unknown[]) => unknown) {
  const create = vi.fn(impl);
  mockGetRazorpayClient.mockReturnValue({
    subscriptions: { create },
  } as unknown as ReturnType<typeof getRazorpayClient>);
  return create;
}

const CHECKOUT_INPUT = { planId: "starter", interval: "1_month" } as const;

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
  // Allowed by default — tests exercising the rate-limit block override this
  // with a rejected promise instead.
  mockCheckRateLimit.mockResolvedValue(undefined);
  mockGetRazorpayPlanId.mockReturnValue("plan_test_starter_1m");
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
    // Rate-limited under the shared "manage an existing subscription" scope
    // (billing:manage), keyed on the caller's own organization — same
    // identity pattern every other authenticated action in this codebase
    // uses (see campaign:launch/campaign:enroll).
    expect(mockCheckRateLimit).toHaveBeenCalledWith("billing:manage", ORGANIZATION.id);
  });

  it("blocks cancellation when the org has exceeded the billing:manage rate limit, without calling Razorpay", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockCheckRateLimit.mockRejectedValue(new RateLimitError(300));
    const cancel = mockCancel(async () => ({}));

    await expect(cancelRazorpaySubscriptionAction()).rejects.toThrow(RateLimitError);

    expect(mockGetSubscriptionV2).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
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

describe("createRazorpaySubscriptionAction", () => {
  it("starts a checkout for the caller's own organization, rate-limited under billing:checkout", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(null as never);
    const create = mockCreate(async () => ({ id: "sub_new_razorpay_id" }));

    const result = await createRazorpaySubscriptionAction(CHECKOUT_INPUT);

    expect(result).toEqual({ subscriptionId: "sub_new_razorpay_id", prefillEmail: USER.email });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: "plan_test_starter_1m",
        notes: expect.objectContaining({ organization_id: ORGANIZATION.id }),
      }),
    );
    // Rate-limited under the shared "start a new checkout" scope
    // (billing:checkout), keyed on the caller's own organization — checked
    // before the plan-id lookup or any Razorpay API call.
    expect(mockCheckRateLimit).toHaveBeenCalledWith("billing:checkout", ORGANIZATION.id);
  });

  it("blocks starting a checkout when the org has exceeded the billing:checkout rate limit, without calling Razorpay", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockCheckRateLimit.mockRejectedValue(new RateLimitError(300));
    const create = mockCreate(async () => ({}));

    await expect(createRazorpaySubscriptionAction(CHECKOUT_INPUT)).rejects.toThrow(RateLimitError);

    expect(mockGetRazorpayPlanId).not.toHaveBeenCalled();
    expect(mockGetSubscriptionV2).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a second checkout while a live subscription exists (the state the billing page now shows as 'Plan changes not available yet')", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    const create = mockCreate(() => Promise.resolve({ id: "sub_new" }));

    for (const status of ["pending", "active", "past_due"]) {
      mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ normalized_status: status }) as never);
      await expect(createRazorpaySubscriptionAction(CHECKOUT_INPUT)).rejects.toThrow(/already have an active subscription/);
    }
    expect(create).not.toHaveBeenCalled();
  });
});

// Polled after Razorpay Checkout's client-side success callback — the page
// refreshes into the paid plan only once the WEBHOOK has confirmed it.
describe("getRazorpayCheckoutStatusAction", () => {
  // Real Razorpay subscription ids are "sub_" + alphanumerics.
  const PAID_SUBSCRIPTION_ID = "sub_Pq8aX2kLm9Zt41";

  function grantingView(overrides: Record<string, unknown> = {}) {
    return { provider: "razorpay", grantsAccess: true, ...overrides } as never;
  }

  it("reports confirmed once the webhook-written row for this exact subscription grants access", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ provider_subscription_id: PAID_SUBSCRIPTION_ID }) as never);
    mockGetActiveSubscriptionView.mockResolvedValue(grantingView());

    await expect(getRazorpayCheckoutStatusAction(PAID_SUBSCRIPTION_ID)).resolves.toEqual({ confirmed: true });
    expect(mockGetSubscriptionV2).toHaveBeenCalledWith(expect.anything(), ORGANIZATION.id);
  });

  it("is not confirmed before the webhook has written anything, even though the client reported success", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(null);
    mockGetActiveSubscriptionView.mockResolvedValue(grantingView({ provider: null, grantsAccess: false }));

    await expect(getRazorpayCheckoutStatusAction(PAID_SUBSCRIPTION_ID)).resolves.toEqual({ confirmed: false });
  });

  it("is not confirmed for a different subscription than the one just paid for", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ provider_subscription_id: "sub_older" }) as never);
    mockGetActiveSubscriptionView.mockResolvedValue(grantingView());

    await expect(getRazorpayCheckoutStatusAction(PAID_SUBSCRIPTION_ID)).resolves.toEqual({ confirmed: false });
  });

  it("is not confirmed when the row exists but doesn't grant access (e.g. halted, or period lapsed)", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetSubscriptionV2.mockResolvedValue(razorpaySubscription({ provider_subscription_id: PAID_SUBSCRIPTION_ID, normalized_status: "suspended" }) as never);
    mockGetActiveSubscriptionView.mockResolvedValue(grantingView({ grantsAccess: false }));

    await expect(getRazorpayCheckoutStatusAction(PAID_SUBSCRIPTION_ID)).resolves.toEqual({ confirmed: false });
  });

  it("rejects an unauthenticated caller before reading anything", async () => {
    await expect(getRazorpayCheckoutStatusAction(PAID_SUBSCRIPTION_ID)).rejects.toThrow(/Unauthorized/);
    expect(mockGetSubscriptionV2).not.toHaveBeenCalled();
  });

  it("rejects a malformed subscription id", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    await expect(getRazorpayCheckoutStatusAction("not-a-subscription-id")).rejects.toBeTruthy();
    expect(mockGetSubscriptionV2).not.toHaveBeenCalled();
  });
});
