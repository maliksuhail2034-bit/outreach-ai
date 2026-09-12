"use server";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/db";
import { getSubscriptionV2 } from "@/lib/db/billing-v2";
import { getRazorpayPlanId } from "@/lib/billing/plans";
import { getRazorpayClient, totalCountForInterval } from "@/lib/billing/razorpay";
import { checkoutSchema, type CheckoutInput } from "@/lib/validations/billing";

// Statuses that indicate the organization already has a confirmed,
// non-terminal Razorpay subscription — checking against these (not just
// "any row exists") lets an org whose old subscription genuinely ended
// (cancelled/expired/completed) start a fresh checkout instead of being
// permanently blocked by a stale row. Kept local rather than importing
// lib/billing/resolve-plan.ts's ACTIVE_STATUSES: that set is explicitly
// Stripe-status-shaped (its own comment says so) and this phase must not
// couple the new Razorpay path to it — see the Phase boundary notes in
// app/api/webhooks/razorpay/route.ts.
const NON_TERMINAL_STATUSES = new Set(["pending", "active", "past_due"]);

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client only ever offers
// buttons for the plans/intervals actually configured — same reasoning
// app/(app)/billing/actions.ts's createCheckoutSessionAction already
// documents for its Stripe equivalent.
//
// Deliberately does NOT write billing_customers_v2/subscriptions_v2 — per
// the approved architecture, only the webhook (app/api/webhooks/razorpay/
// route.ts), once Razorpay confirms the authentication transaction, is
// authoritative. This action only creates the provider-side Subscription
// object and hands the client the minimum it needs to open Razorpay
// Checkout. It also does NOT pre-create a Razorpay Customer: Razorpay's
// Create Subscription API has no customer_id parameter at all (confirmed
// via official docs during the Phase 0 design review) — the customer is
// created/linked by Razorpay automatically during checkout.js
// authentication, not by this server action.
export async function createRazorpaySubscriptionAction(
  input: CheckoutInput,
): Promise<{ subscriptionId: string; prefillEmail: string | undefined }> {
  const parsed = checkoutSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  const organization = await getUserOrganization(supabase, user);

  const razorpayPlanId = getRazorpayPlanId(parsed.planId, parsed.interval);
  if (!razorpayPlanId) {
    throw new Error("This plan isn't available yet. Try again shortly or contact support.");
  }

  // Duplicate-checkout guard: block starting a second subscription while a
  // confirmed, non-terminal one already exists. This only ever sees
  // webhook-confirmed rows (subscriptions_v2 is never written from this
  // action) — a narrow race between two near-simultaneous requests before
  // either reaches a webhook-confirmed state is a known, accepted gap for
  // this phase (see the Phase 0 design review's duplicate-checkout
  // analysis), not something this check alone can close;
  // subscriptions_v2's own unique(organization_id) constraint remains the
  // real backstop against two *confirmed* rows ever coexisting.
  const existing = await getSubscriptionV2(supabase, organization.id);
  if (existing && NON_TERMINAL_STATUSES.has(existing.normalized_status)) {
    throw new Error("You already have an active subscription. Manage it from the Billing page instead.");
  }

  try {
    const subscription = await getRazorpayClient().subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: totalCountForInterval(parsed.interval),
      customer_notify: true,
      // The primary, officially-supported organization-resolution
      // mechanism the webhook reads from — see
      // lib/billing/sync-subscription-v2.ts. internal_plan_id/
      // billing_interval are captured here too (not re-derived from
      // razorpayPlanId at webhook time) so a later env var reconfiguration
      // can never retroactively change what an already-created
      // subscription resolves to.
      notes: {
        organization_id: organization.id,
        internal_plan_id: parsed.planId,
        billing_interval: parsed.interval,
      },
    });

    return { subscriptionId: subscription.id, prefillEmail: user.email };
  } catch (error) {
    // Sanitized for the client — getRazorpayClient()'s own "not configured"
    // error, or a raw Razorpay API failure, must never reach the browser
    // verbatim. Full detail stays server-side only.
    console.error("[razorpay] failed to create subscription", error);
    throw new Error("Couldn't start checkout. Try again shortly or contact support.");
  }
}
