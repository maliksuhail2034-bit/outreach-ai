import type { Plans } from "razorpay/dist/types/plans";
import type { Subscriptions } from "razorpay/dist/types/subscriptions";
import type { Client } from "@/lib/db/shared";
import { getSubscriptionV2, upsertBillingCustomerV2, upsertSubscriptionV2 } from "@/lib/db/billing-v2";
import {
  isRecognizedRazorpayStatus,
  NON_TERMINAL_SUBSCRIPTION_STATUSES,
  normalizeRazorpaySubscriptionStatus,
} from "./razorpay-status";
import { BILLING_INTERVALS, PAID_PLAN_IDS, type BillingInterval, type PaidPlanId } from "./plans";
import { isCurrency, type Currency } from "./currency";
import { getPlanOffering } from "./offerings";
import { monthsForInterval } from "./pricing";

const PROVIDER = "razorpay";

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

// The Razorpay plan a subscription is actually on, fetched from Razorpay by
// the webhook. It's the authority for what the subscription charges —
// currency, amount per cycle, and cycle length.
export interface RazorpayPlanEntity {
  id: string;
  period: string;
  interval: number;
  amount: number;
  currency: string;
}

export function toRazorpayPlanEntity(plan: Plans.RazorPayPlans): RazorpayPlanEntity {
  return {
    id: plan.id,
    period: plan.period,
    interval: plan.interval,
    amount: Number(plan.item.amount),
    currency: plan.item.currency,
  };
}

export type RazorpaySyncResult =
  | { outcome: "synced"; organizationId: string; currency: Currency; unrecognizedStatus: boolean }
  // notes don't identify an organization/plan/interval — nothing written.
  | { outcome: "unmapped" }
  // The subscription's notes (plan, interval, currency) don't match the
  // Razorpay plan it's actually on — nothing written, so no paid access is
  // granted or extended on its strength.
  | { outcome: "plan_mismatch"; organizationId: string; reason: string }
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

function monthsPerCycle(plan: RazorpayPlanEntity): number | null {
  if (plan.period === "monthly") return plan.interval;
  if (plan.period === "yearly") return plan.interval * 12;
  return null;
}

// Checks that the Razorpay plan a subscription is on is the one its notes
// say it was bought as. Returns why not, or null when everything agrees.
// Compared against the plan's own currency, amount and cycle rather than
// against the configured plan id, so rotating a RAZORPAY_PLAN_* env var later
// can't make existing subscriptions fail this check.
function planMismatch(
  subscription: RazorpaySubscriptionEntity,
  plan: RazorpayPlanEntity,
  internalPlanId: PaidPlanId,
  billingInterval: BillingInterval,
  notedCurrency: unknown,
): { reason: string } | { currency: Currency } {
  if (plan.id !== subscription.plan_id) {
    return { reason: "fetched plan is not the subscription's plan" };
  }
  if (!isCurrency(plan.currency)) {
    return { reason: `plan currency ${plan.currency} is not supported` };
  }
  // Subscriptions created before USD support carry no currency note; their
  // currency is the plan's, still checked against the expected amount below.
  if (notedCurrency !== undefined && notedCurrency !== plan.currency) {
    return { reason: `notes currency ${String(notedCurrency)} does not match plan currency ${plan.currency}` };
  }
  if (monthsPerCycle(plan) !== monthsForInterval(billingInterval)) {
    return { reason: `plan cycle ${plan.interval} ${plan.period} does not match ${billingInterval}` };
  }
  const expectedAmount = getPlanOffering(internalPlanId, billingInterval, plan.currency).amount;
  if (plan.amount !== expectedAmount) {
    return {
      reason: `plan amount ${plan.amount} ${plan.currency} does not match ${internalPlanId} ${billingInterval} (${expectedAmount})`,
    };
  }
  return { currency: plan.currency };
}

// Before an open checkout's existing Razorpay subscription is handed back to
// the browser again: checks it was created for this organization and this
// exact offering, using the same plan check (currency, cycle, amount) the
// webhook applies. Returns why not, or null when it matches.
export function checkoutSubscriptionMismatch(
  subscription: RazorpaySubscriptionEntity,
  plan: RazorpayPlanEntity,
  expected: { organizationId: string; planId: PaidPlanId; interval: BillingInterval; currency: Currency },
): string | null {
  const notes = subscription.notes ?? {};
  if (notes.organization_id !== expected.organizationId) return "subscription belongs to a different organization";
  if (notes.internal_plan_id !== expected.planId) return "subscription is for a different plan";
  if (notes.billing_interval !== expected.interval) return "subscription is for a different interval";
  if (notes.currency !== expected.currency) return "subscription is in a different currency";
  const match = planMismatch(subscription, plan, expected.planId, expected.interval, notes.currency);
  return "reason" in match ? match.reason : null;
}

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
//
// `plan` is the Razorpay plan the subscription is on, fetched from Razorpay.
// The notes must agree with it (see planMismatch) before anything is
// written, and the stored currency is the plan's — never a hardcoded value
// or anything from the browser.
export async function syncSubscriptionFromRazorpay(
  supabase: Client,
  subscription: RazorpaySubscriptionEntity,
  plan: RazorpayPlanEntity,
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

  const match = planMismatch(subscription, plan, internalPlanId, billingInterval, notes.currency);
  if ("reason" in match) {
    console.error("[razorpay] subscription notes don't match its Razorpay plan", subscription.id, match.reason);
    return { outcome: "plan_mismatch", organizationId, reason: match.reason };
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
    currency: match.currency,
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

  return {
    outcome: "synced",
    organizationId,
    currency: match.currency,
    unrecognizedStatus: !isRecognizedRazorpayStatus(subscription.status),
  };
}
