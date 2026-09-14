import { beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the seam" approach as razorpay-actions.test.ts. redirect() is
// mocked as a no-op rather than left real: Next.js's real redirect() throws
// a special internal control-flow error outside an actual request/render
// context, which isn't what these tests are checking — they only need to
// observe whether/with-what it was called.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  getBillingCustomer: vi.fn(),
  getUserOrganization: vi.fn(),
}));
vi.mock("@/lib/billing/stripe", () => ({
  getStripeClient: vi.fn(),
}));
vi.mock("@/lib/billing/plans", () => ({
  getPriceId: vi.fn(),
  // Real value, not mocked — lib/validations/billing.ts's checkoutSchema
  // (imported transitively by actions.ts) builds a real z.enum() from this
  // at module-load time, so it must stay a real, non-empty array.
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

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/auth";
import { getBillingCustomer, getUserOrganization } from "@/lib/db";
import { getStripeClient } from "@/lib/billing/stripe";
import { getPriceId } from "@/lib/billing/plans";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import { createCheckoutSessionAction, createPortalSessionAction } from "./actions";

const mockRedirect = vi.mocked(redirect);
const mockRequireUser = vi.mocked(requireUser);
const mockGetBillingCustomer = vi.mocked(getBillingCustomer);
const mockGetUserOrganization = vi.mocked(getUserOrganization);
const mockGetStripeClient = vi.mocked(getStripeClient);
const mockGetPriceId = vi.mocked(getPriceId);
const mockCheckRateLimit = vi.mocked(checkRateLimit);

const USER = { id: "user-1", email: "owner@example.com" };
const ORGANIZATION = { id: "org-1" };
const CHECKOUT_INPUT = { planId: "starter", interval: "1_month" } as const;

function mockStripe(overrides: {
  createSession?: (...args: unknown[]) => unknown;
  createPortal?: (...args: unknown[]) => unknown;
}) {
  const createSession = vi.fn(overrides.createSession ?? (async () => ({ url: "https://checkout.stripe.com/session" })));
  const createPortal = vi.fn(overrides.createPortal ?? (async () => ({ url: "https://billing.stripe.com/portal" })));
  mockGetStripeClient.mockReturnValue({
    checkout: { sessions: { create: createSession } },
    billingPortal: { sessions: { create: createPortal } },
  } as unknown as ReturnType<typeof getStripeClient>);
  return { createSession, createPortal };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://polimatiq.example";
  // Unauthenticated is the default per requireUser's own contract — tests
  // that need a signed-in user opt in explicitly.
  mockRequireUser.mockRejectedValue(new Error("Unauthorized: no authenticated user."));
  mockGetUserOrganization.mockResolvedValue(ORGANIZATION as never);
  // Allowed by default — the rate-limit tests override this with a rejection.
  mockCheckRateLimit.mockResolvedValue(undefined);
  mockGetPriceId.mockReturnValue("price_test_starter_1m");
});

describe("createCheckoutSessionAction", () => {
  it("starts a Stripe Checkout session for the caller's own organization, rate-limited under billing:checkout", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetBillingCustomer.mockResolvedValue(null as never);
    const { createSession } = mockStripe({});

    await createCheckoutSessionAction(CHECKOUT_INPUT);

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_test_starter_1m", quantity: 1 }],
        client_reference_id: ORGANIZATION.id,
      }),
    );
    expect(mockRedirect).toHaveBeenCalledWith("https://checkout.stripe.com/session");
    // Rate-limited under the shared "start a new checkout" scope
    // (billing:checkout), keyed on the caller's own organization — same
    // scope createRazorpaySubscriptionAction uses (see razorpay-actions.test.ts).
    expect(mockCheckRateLimit).toHaveBeenCalledWith("billing:checkout", ORGANIZATION.id);
  });

  it("blocks starting a checkout when the org has exceeded the billing:checkout rate limit, without calling Stripe", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockCheckRateLimit.mockRejectedValue(new RateLimitError(300));
    const { createSession } = mockStripe({});

    await expect(createCheckoutSessionAction(CHECKOUT_INPUT)).rejects.toThrow(RateLimitError);

    expect(mockGetBillingCustomer).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("createPortalSessionAction", () => {
  it("opens the Stripe portal for an org with a billing customer on file, rate-limited under billing:manage", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockGetBillingCustomer.mockResolvedValue({ stripe_customer_id: "cus_real_123" } as never);
    const { createPortal } = mockStripe({});

    await createPortalSessionAction();

    expect(createPortal).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_real_123" }),
    );
    expect(mockRedirect).toHaveBeenCalledWith("https://billing.stripe.com/portal");
    expect(mockCheckRateLimit).toHaveBeenCalledWith("billing:manage", ORGANIZATION.id);
  });

  it("blocks opening the portal when the org has exceeded the billing:manage rate limit, without calling Stripe", async () => {
    mockRequireUser.mockResolvedValue(USER as never);
    mockCheckRateLimit.mockRejectedValue(new RateLimitError(300));
    const { createPortal } = mockStripe({});

    await expect(createPortalSessionAction()).rejects.toThrow(RateLimitError);

    expect(mockGetBillingCustomer).not.toHaveBeenCalled();
    expect(createPortal).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
