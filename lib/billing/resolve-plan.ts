import type { Client } from "@/lib/db/shared";
import { getSubscription } from "@/lib/db/billing";
import { getPlan, getPlanByPriceId, PLANS, type Plan } from "./plans";

// Subscription statuses that still grant the plan's access. `past_due`
// is included deliberately — Stripe's own guidance is not to cut a
// customer off the moment a renewal payment fails (that's what dunning
// retries/emails are for); it only stops granting access once Stripe
// itself gives up and moves the subscription to `unpaid`/`canceled`.
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

// The only place that decides "what plan is this organization actually
// on" — every usage-limit check and the billing UI both call this rather
// than reading subscriptions.status/stripe_price_id directly, so the
// access rule above only has to be encoded once.
export async function getPlanForOrganization(supabase: Client, organizationId: string): Promise<Plan> {
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
