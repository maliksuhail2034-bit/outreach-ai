import type { Client } from "@/lib/db/shared";
import { getActiveSubscriptionView } from "./subscription-view";
import { getPlan, UNLIMITED, type Plan } from "./plans";

// The operator's own organization (maliksuhail2034@gmail.com's
// "maliksuhail2034's workspace") — granted unlimited access outside the
// Stripe billing flow entirely, since this environment has no Stripe price
// ids configured yet (see lib/billing/plans.ts) and this account isn't a
// paying customer. Hardcoded to this one organization id (not an env var,
// not an email/role check) so it can never apply to any other account,
// including future real ones.
const INTERNAL_UNLIMITED_ORGANIZATION_ID = "7ef89392-80ba-4447-a7b7-ba642ff00a53";

// Unlike PLANS.scale, this has no cap at all on any dimension — the highest
// real paid tier still caps dailySends/emailsPerMonth at concrete numbers,
// which doesn't fit "unlimited". Never sold, so no price of any kind.
const INTERNAL_UNLIMITED_PLAN: Plan = {
  id: "scale",
  name: "Unlimited (Internal)",
  limits: { mailboxes: UNLIMITED, leads: UNLIMITED, campaigns: UNLIMITED, dailySends: UNLIMITED, emailsPerMonth: UNLIMITED },
  regularPriceCents: null,
  launchPriceCents: null,
  priceIds: { "1_month": null, "3_month": null, "6_month": null, "12_month": null },
};

// The only place that decides "what plan is this organization actually
// on" — every usage-limit check and the billing UI both call this rather
// than reading subscription state directly, so the access rule only has to
// be encoded once. As of Phase 2, that encoding lives in
// lib/billing/subscription-view.ts's getActiveSubscriptionView(), which
// reads both the legacy Stripe-shaped `subscriptions` table and the
// provider-agnostic `subscriptions_v2` table and resolves precedence
// between them — this function is now a thin wrapper around it, keeping
// the one pre-existing special case (below) ahead of normal resolution.
export async function getPlanForOrganization(supabase: Client, organizationId: string): Promise<Plan> {
  if (organizationId === INTERNAL_UNLIMITED_ORGANIZATION_ID) return INTERNAL_UNLIMITED_PLAN;

  const view = await getActiveSubscriptionView(supabase, organizationId);
  return view.grantsAccess ? getPlan(view.planId) : getPlan("free");
}
