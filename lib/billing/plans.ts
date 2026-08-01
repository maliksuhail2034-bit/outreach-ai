// Single source of truth for plan tiers/limits/pricing — every place that
// needs to know what a plan includes (usage gating, the billing UI, the
// webhook handler resolving a price id back to a plan) reads from here
// instead of hardcoding numbers. See lib/billing/resolve-plan.ts for how a
// subscription's stripe_price_id maps back to one of these.

export type PlanId = "free" | "starter" | "pro" | "agency";
export type BillingInterval = "monthly" | "yearly";

// -1 means unlimited.
export interface PlanLimits {
  mailboxes: number;
  leads: number;
  campaigns: number;
  // Aggregate cap on campaigns.daily_limit summed across the account — see
  // lib/billing/limits.ts for exactly what this gates and why.
  dailySends: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  limits: PlanLimits;
  // null for the free plan (nothing to check out) and for any paid plan
  // whose price id hasn't been configured yet in this environment.
  monthlyPriceId: string | null;
  // Yearly billing is modeled end-to-end (price id lookup, checkout,
  // webhook resolution) but deliberately not surfaced in the UI yet — see
  // components/billing/plan-list.tsx.
  yearlyPriceId: string | null;
}

export const UNLIMITED = -1;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    limits: { mailboxes: 1, leads: 200, campaigns: 1, dailySends: 50 },
    monthlyPriceId: null,
    yearlyPriceId: null,
  },
  starter: {
    id: "starter",
    name: "Starter",
    limits: { mailboxes: 3, leads: 2000, campaigns: 5, dailySends: 300 },
    monthlyPriceId: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? null,
    yearlyPriceId: process.env.STRIPE_PRICE_STARTER_YEARLY ?? null,
  },
  pro: {
    id: "pro",
    name: "Pro",
    limits: { mailboxes: 10, leads: 20000, campaigns: 25, dailySends: 1500 },
    monthlyPriceId: process.env.STRIPE_PRICE_PRO_MONTHLY ?? null,
    yearlyPriceId: process.env.STRIPE_PRICE_PRO_YEARLY ?? null,
  },
  agency: {
    id: "agency",
    name: "Agency",
    limits: { mailboxes: UNLIMITED, leads: UNLIMITED, campaigns: UNLIMITED, dailySends: 10000 },
    monthlyPriceId: process.env.STRIPE_PRICE_AGENCY_MONTHLY ?? null,
    yearlyPriceId: process.env.STRIPE_PRICE_AGENCY_YEARLY ?? null,
  },
};

// Plans a user can actually check out into, in display order. Free is
// excluded — it's the default state, not something Checkout ever runs for.
// `as const` so lib/validations/billing.ts's z.enum(PAID_PLAN_IDS) infers
// the literal "starter" | "pro" | "agency" union instead of widening to
// plain string.
export const PAID_PLAN_IDS = ["starter", "pro", "agency"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

// Resolves a Stripe price id (as reported by a subscription, e.g. from a
// webhook) back to the plan it belongs to. Checks both intervals since a
// price id alone doesn't say which — the caller doesn't need to know the
// interval to determine access/limits, only which plan tier it is.
export function getPlanByPriceId(priceId: string): Plan | null {
  for (const plan of Object.values(PLANS)) {
    if (plan.monthlyPriceId === priceId || plan.yearlyPriceId === priceId) return plan;
  }
  return null;
}

export function getPriceId(planId: PlanId, interval: BillingInterval): string | null {
  const plan = PLANS[planId];
  return interval === "monthly" ? plan.monthlyPriceId : plan.yearlyPriceId;
}
