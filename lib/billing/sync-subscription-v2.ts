import type { Subscriptions } from "razorpay/dist/types/subscriptions";
import type { Client } from "@/lib/db/shared";
import { getSubscriptionV2, upsertBillingCustomerV2, upsertSubscriptionV2 } from "@/lib/db/billing-v2";
import {
  isRecognizedRazorpayStatus,
  NON_TERMINAL_SUBSCRIPTION_STATUSES,
  normalizeRazorpaySubscriptionStatus,
} from "./razorpay-status";
import { BILLING_INTERVALS, PAID_PLAN_IDS, type BillingInterval, type PaidPlanId } from "./plans";
import { ROUTE_CURRENCY } from "./currency";

const PROVIDER = "razorpay";

// This webhook handler is exclusively the Razorpay India payment route —
// see the Razorpay architecture investigation: Indian payment rails
// (UPI/Indian cards/netbanking) can only ever charge INR, and this
// account's Razorpay Plans are always INR-denominated (see
// lib/billing/currency.ts's ROUTE_CURRENCY). Hardcoded, not inferred from
// any field on the webhook payload or user input — a future
// Razorpay-International or PayPal sync function would hardcode its own
// route's currency ("international" -> USD) the same way, in its own
// module, rather than this one branching on provider/currency at runtime.
const CURRENCY = ROUTE_CURRENCY.razorpay_india;

// The subset of Razorpay's Subscription entity this webhook handler
// actually reads — not the SDK's own Subscriptions.RazorpaySubscription
// type. Deliberately narrower and independently typed: the installed SDK's
// `status` field is typed as a union that's missing "paused" even though
// Razorpay's own docs (and the subscription.paused webhook event) confirm
// it's a real status — see node_modules/razorpay/dist/types/
// subscriptions.d.ts — so `status` is kept as a plain string here rather
// than trusting that union. Exported so app/api/webhooks/razorpay/route.ts
// can type the parsed webhook payload against the same shape.
export interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  customer_id: string | null;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  notes?: Record<string, string | number> | null;
}

// The webhook re-fetches every subscription from Razorpay rather than
// trusting the event payload's snapshot (see
// app/api/webhooks/razorpay/route.ts); this narrows the SDK's own object
// down to the fields this module reads.
export function toRazorpaySubscriptionEntity(subscription: Subscriptions.RazorpaySubscription): RazorpaySubscriptionEntity {
  return {
    id: subscription.id,
    plan_id: subscription.plan_id,
    customer_id: subscription.customer_id ?? null,
    status: subscription.status,
    current_start: subscription.current_start ?? null,
    current_end: subscription.current_end ?? null,
    notes: (subscription.notes as Record<string, string | number> | undefined) ?? null,
  };
}

export type RazorpaySyncResult =
  | { outcome: "synced"; organizationId: string; unrecognizedStatus: boolean }
  // notes don't identify an organization/plan/interval — nothing written.
  | { outcome: "unmapped" }
  // The organization's current row is a different subscription that is
  // still live, so this one was not written over it. `incomingNonTerminal`
  // says whether this one is live too (two live subscriptions — needs a
  // person) or already over (an old subscription's late event — harmless).
  | {
      outcome: "skipped_other_current_subscription";
      organizationId: string;
      currentSubscriptionId: string;
      incomingNonTerminal: boolean;
    };

function unixToIso(seconds: number | null | undefined): string | null {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
}

// The single writer of Razorpay subscription state — called from every
// handled webhook event branch (see app/api/webhooks/razorpay/route.ts),
// mirroring lib/billing/sync-subscription.ts's syncSubscriptionFromStripe
// in spirit (one shared function, not per-event duplication). Resolves
// organization_id/internal_plan_id/billing_interval from the Subscription's
// own `notes` — attached at creation time by
// app/(app)/billing/razorpay-actions.ts — rather than a metadata lookup
// against billing_customers_v2 the way Stripe's resolveOrganizationId
// falls back to: Razorpay's Create Subscription API has no customer_id
// parameter at all (confirmed via official docs during the Phase 0 design
// review — the customer is linked automatically only after the customer
// completes checkout), so there is no pre-existing customer row to look
// this up against even as a fallback. `notes` is the only reliable,
// officially-supported correlation mechanism available at webhook time.
//
// Never guesses: unresolvable notes write nothing ("unmapped"), so a
// subscription is never attached to the wrong organization. A bogus
// organization_id also fails at the database layer —
// subscriptions_v2.organization_id is a foreign key.
//
// subscriptions_v2 holds one row per organization, so writing a different
// subscription replaces the current one. That's only allowed once the
// current one has ended; otherwise a late event for an old subscription
// could overwrite (and revoke) the subscription the customer is paying for.
export async function syncSubscriptionFromRazorpay(
  supabase: Client,
  subscription: RazorpaySubscriptionEntity,
): Promise<RazorpaySyncResult> {
  const notes = subscription.notes ?? {};
  const organizationId = typeof notes.organization_id === "string" ? notes.organization_id : null;
  const internalPlanId = isPaidPlanId(notes.internal_plan_id) ? notes.internal_plan_id : null;
  const billingInterval = isBillingInterval(notes.billing_interval) ? notes.billing_interval : null;

  if (!organizationId || !internalPlanId || !billingInterval) {
    console.error(
      "[razorpay] couldn't resolve organization/plan/interval from subscription notes",
      subscription.id,
    );
    return { outcome: "unmapped" };
  }

  const normalizedStatus = normalizeRazorpaySubscriptionStatus(subscription.status);

  const current = await getSubscriptionV2(supabase, organizationId);
  if (
    current &&
    !(current.provider === PROVIDER && current.provider_subscription_id === subscription.id) &&
    NON_TERMINAL_SUBSCRIPTION_STATUSES.has(current.normalized_status)
  ) {
    return {
      outcome: "skipped_other_current_subscription",
      organizationId,
      currentSubscriptionId: current.provider_subscription_id,
      incomingNonTerminal: NON_TERMINAL_SUBSCRIPTION_STATUSES.has(normalizedStatus),
    };
  }

  if (subscription.customer_id) {
    await upsertBillingCustomerV2(supabase, {
      organization_id: organizationId,
      provider: PROVIDER,
      provider_customer_id: subscription.customer_id,
    });
  }

  await upsertSubscriptionV2(supabase, {
    organization_id: organizationId,
    provider: PROVIDER,
    provider_subscription_id: subscription.id,
    provider_plan_id: subscription.plan_id,
    internal_plan_id: internalPlanId,
    billing_interval: billingInterval,
    currency: CURRENCY,
    provider_status: subscription.status,
    normalized_status: normalizedStatus,
    current_period_start: unixToIso(subscription.current_start),
    current_period_end: unixToIso(subscription.current_end),
    // Razorpay's Subscription entity has no cancel_at_cycle_end-equivalent
    // field to read back (confirmed via the installed SDK's own types
    // during Phase 0) — "cancel at cycle end" is a one-time action
    // parameter, not persistent entity state. Always false in this phase;
    // normalized_status transitioning to "cancelled" is the authoritative
    // signal, per the approved architecture ("do not infer cancellation
    // state from indirect provider fields").
    cancel_at_period_end: false,
  });

  return { outcome: "synced", organizationId, unrecognizedStatus: !isRecognizedRazorpayStatus(subscription.status) };
}
