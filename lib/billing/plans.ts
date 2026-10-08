// Single source of truth for plan tiers/limits/pricing — every place that
// needs to know what a plan includes (usage gating, the billing UI, the
// webhook handler resolving a price id back to a plan) reads from here
// instead of hardcoding numbers. See lib/billing/resolve-plan.ts for how a
// subscription's stripe_price_id maps back to one of these.
//
// "free" is NOT a publicly sellable plan — see PAID_PLAN_IDS below. It only
// exists as resolve-plan.ts's safe fallback for an organization with no
// active subscription, and stays out of PAID_PLAN_IDS and every UI plan
// grid (components/billing/plan-list.tsx, components/marketing/
// pricing-preview.tsx) so it's never shown or purchasable.

export type PlanId = "free" | "starter" | "growth" | "pro" | "scale";

// Every public paid plan supports the same 4 billing durations, each at a
// fixed discount off that plan's launch price (see lib/billing/pricing.ts
// for the actual math) — never off the crossed-out regular price.
export type BillingInterval = "1_month" | "3_month" | "6_month" | "12_month";

export const BILLING_INTERVALS: readonly BillingInterval[] = ["1_month", "3_month", "6_month", "12_month"];

// -1 means unlimited.
export interface PlanLimits {
  mailboxes: number;
  leads: number;
  campaigns: number;
  // Aggregate cap on campaigns.daily_limit summed across the account — a
  // configuration-time ceiling (checked in lib/billing/limits.ts whenever a
  // campaign's daily_limit is set), not a count of emails actually sent.
  dailySends: number;
  // Actual emails sent this calendar month, counted from email_events
  // (event_type = 'sent') and enforced at send time in
  // lib/email/send-worker.ts — see lib/billing/limits.ts's
  // isWithinMonthlyEmailLimit. Distinct from dailySends: this is the real,
  // send-time-enforced volume cap the launch pricing is built around.
  emailsPerMonth: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  limits: PlanLimits;
  // In cents (Stripe's own convention), so a future real Stripe Price's
  // unit_amount can be read directly off these without a conversion step.
  // null for the internal fallback plan — it's never sold, so it has no
  // price at all, regular or launch.
  regularPriceCents: number | null;
  launchPriceCents: number | null;
  // One Stripe Price id per billing duration, from env vars. All null in
  // this environment until Stripe is actually configured — see
  // .env.example. A null entry means that plan/interval's Checkout button
  // is disabled ("Coming soon") rather than erroring.
  priceIds: Record<BillingInterval, string | null>;
}

export const UNLIMITED = -1;

function priceIdsFor(planEnvPrefix: string): Record<BillingInterval, string | null> {
  return {
    "1_month": process.env[`STRIPE_PRICE_${planEnvPrefix}_1MONTH`] ?? null,
    "3_month": process.env[`STRIPE_PRICE_${planEnvPrefix}_3MONTH`] ?? null,
    "6_month": process.env[`STRIPE_PRICE_${planEnvPrefix}_6MONTH`] ?? null,
    "12_month": process.env[`STRIPE_PRICE_${planEnvPrefix}_12MONTH`] ?? null,
  };
}

const NO_PRICE_IDS: Record<BillingInterval, string | null> = {
  "1_month": null,
  "3_month": null,
  "6_month": null,
  "12_month": null,
};

export const PLANS: Record<PlanId, Plan> = {
  // Internal-only fail-safe (see lib/billing/resolve-plan.ts) — every
  // organization with no active subscription resolves here. Deliberately
  // restrictive (well below Starter, the cheapest real plan) and carries no
  // price: it is never offered, listed, or checked out into anywhere in the
  // UI. Limits are unchanged from before this restructure, so they stay
  // load-bearing exactly as before for any org that hasn't subscribed yet.
  // `name` is deliberately NOT "Free" — Polimatiq has no public Free plan,
  // and this id ("free") is purely an internal PlanId key retained so
  // resolve-plan.ts's existing fail-closed logic (and its tests) didn't
  // need to change. Every user-facing surface that could show this plan's
  // name (billing page "Current plan", PlanLimitError messages — see
  // lib/billing/limits.ts's planLimitPrefix) reads this string directly, so
  // it must never say "Free" or imply a purchasable tier.
  free: {
    id: "free",
    name: "No active subscription",
    limits: { mailboxes: 1, leads: 200, campaigns: 1, dailySends: 50, emailsPerMonth: 100 },
    regularPriceCents: null,
    launchPriceCents: null,
    priceIds: NO_PRICE_IDS,
  },
  starter: {
    id: "starter",
    name: "Starter",
    limits: { mailboxes: 3, leads: 500, campaigns: 5, dailySends: 150, emailsPerMonth: 3000 },
    regularPriceCents: 1900,
    launchPriceCents: 1200,
    priceIds: priceIdsFor("STARTER"),
  },
  growth: {
    id: "growth",
    name: "Growth",
    limits: { mailboxes: 9, leads: 3000, campaigns: 15, dailySends: 400, emailsPerMonth: 10000 },
    regularPriceCents: 2900,
    launchPriceCents: 2200,
    priceIds: priceIdsFor("GROWTH"),
  },
  pro: {
    id: "pro",
    name: "Pro",
    limits: { mailboxes: 20, leads: 10000, campaigns: 40, dailySends: 2000, emailsPerMonth: 50000 },
    regularPriceCents: 7900,
    launchPriceCents: 5200,
    priceIds: priceIdsFor("PRO"),
  },
  // Limits proposed from the product's current architecture, not invented
  // as "unlimited" per the launch decision: 50 mailboxes and 8,000/day of
  // aggregate configured capacity comfortably clears 200,000 emails/month
  // (~6,667/day average) with headroom for real-world sending-window/ramp
  // variance; 50,000 leads and 100 campaigns follow the same ~5x step up
  // from Pro that each lower tier already takes from the one below it.
  scale: {
    id: "scale",
    name: "Scale",
    limits: { mailboxes: 50, leads: 50000, campaigns: 100, dailySends: 8000, emailsPerMonth: 200000 },
    regularPriceCents: 19900,
    launchPriceCents: 17900,
    priceIds: priceIdsFor("SCALE"),
  },
};

// Plans a user can actually check out into, in display order. Free is
// excluded — it's the internal no-subscription fallback, never something
// Checkout runs for or the UI lists. `as const` so
// lib/validations/billing.ts's z.enum(PAID_PLAN_IDS) infers the literal
// "starter" | "growth" | "pro" | "scale" union instead of widening to plain
// string. Enterprise is deliberately not a PlanId at all yet — custom
// pricing, discussed and implemented separately.
export const PAID_PLAN_IDS = ["starter", "growth", "pro", "scale"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

// Resolves a Stripe price id (as reported by a subscription, e.g. from a
// webhook) back to the plan it belongs to. Checks every configured interval
// since a price id alone doesn't say which — the caller doesn't need to
// know the interval to determine access/limits, only which plan tier it is.
export function getPlanByPriceId(priceId: string): Plan | null {
  for (const plan of Object.values(PLANS)) {
    if (Object.values(plan.priceIds).includes(priceId)) return plan;
  }
  return null;
}

export function getPriceId(planId: PlanId, interval: BillingInterval): string | null {
  return PLANS[planId].priceIds[interval];
}
