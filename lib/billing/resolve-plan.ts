import type { Client } from "@/lib/db/shared";
import { getSubscription } from "@/lib/db/billing";
import { getPlan, getPlanByPriceId, PLANS, UNLIMITED, type Plan } from "./plans";

// Subscription statuses that still grant the plan's access. `past_due`
// is included deliberately — Stripe's own guidance is not to cut a
// customer off the moment a renewal payment fails (that's what dunning
// retries/emails are for); it only stops granting access once Stripe
// itself gives up and moves the subscription to `unpaid`/`canceled`.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// The operator's own organization (maliksuhail2034@gmail.com's
// "maliksuhail2034's workspace") — granted unlimited access outside the
// Stripe billing flow entirely, since this environment has no Stripe price
// ids configured yet (see lib/billing/plans.ts) and this account isn't a
// paying customer. Hardcoded to this one organization id (not an env var,
// not an email/role check) so it can never apply to any other account,
// including future real ones.
const INTERNAL_UNLIMITED_ORGANIZATION_ID = "7ef89392-80ba-4447-a7b7-ba642ff00a53";

// Unlike PLANS.agency, this has no daily-send cap at all — the highest real
// paid tier still caps dailySends at 10000, which doesn't fit "unlimited".
const INTERNAL_UNLIMITED_PLAN: Plan = {
  id: "agency",
  name: "Unlimited (Internal)",
  limits: { mailboxes: UNLIMITED, leads: UNLIMITED, campaigns: UNLIMITED, dailySends: UNLIMITED },
  monthlyPriceId: null,
  yearlyPriceId: null,
};

// The only place that decides "what plan is this organization actually
// on" — every usage-limit check and the billing UI both call this rather
// than reading subscriptions.status/stripe_price_id directly, so the
// access rule above only has to be encoded once.
export async function getPlanForOrganization(supabase: Client, organizationId: string): Promise<Plan> {
  if (organizationId === INTERNAL_UNLIMITED_ORGANIZATION_ID) return INTERNAL_UNLIMITED_PLAN;

  const subscription = await getSubscription(supabase, organizationId);
  if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) {
    return PLANS.free;
  }

  const plan = getPlanByPriceId(subscription.stripe_price_id);
  // A subscription exists for a price id this environment doesn't
  // recognize (e.g. a price removed from lib/billing/plans.ts, or a
  // stale/test price) — fail closed to free rather than granting access
  // resolved from nothing.
  return plan ?? getPlan("free");
}
