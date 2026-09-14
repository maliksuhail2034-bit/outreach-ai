// Centralized Razorpay provider_status -> normalized_status mapping — the
// single place this decision is encoded, per the approved architecture
// (do not scatter `if (status === ...)` checks across the webhook route or
// anywhere else). This module makes NO access-grant decision itself — it
// only produces the value subscriptions_v2.normalized_status stores.
// lib/billing/resolve-plan.ts is the only place that decides real product
// access — as of the provider-agnostic subscription resolution work, it's a
// thin wrapper around lib/billing/subscription-view.ts's
// getActiveSubscriptionView(), which reads both the legacy `subscriptions`
// table and this table (subscriptions_v2) and resolves precedence between
// them, so a Razorpay subscription genuinely does grant real product
// access, not just billing-page display.

export type NormalizedSubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled"
  | "expired"
  | "completed";

// Every Razorpay subscription status confirmed via official documentation
// (razorpay.com/docs/payments/subscriptions/states,
// razorpay.com/docs/webhooks/subscriptions) during the Phase 0 design
// review. Razorpay's own "pending" status means an auto-charge failed and
// retries are in progress — a different concept from this app's normalized
// "pending" (which means "not yet paid at all") — so it intentionally maps
// to "past_due" instead, mirroring how the legacy Stripe integration treats
// past_due as still access-granting (see subscription-view.ts's
// GRANTING_STATUSES). "paused" (a merchant/dashboard-initiated pause) and "halted"
// (retries exhausted) are semantically different reasons but both result in
// no access, so both map to "suspended" — the normalized vocabulary doesn't
// distinguish them further in this phase.
const RAZORPAY_STATUS_MAP: Record<string, NormalizedSubscriptionStatus> = {
  created: "pending",
  authenticated: "pending",
  active: "active",
  pending: "past_due",
  halted: "suspended",
  paused: "suspended",
  cancelled: "cancelled",
  // Confirmed via razorpay.com/docs/payments/subscriptions/states and
  // razorpay.com/docs/webhooks/subscriptions (checked directly, not from
  // memory): Razorpay has NO webhook event for a subscription entering
  // "expired" — the 10 documented subscription webhook events don't include
  // one (compare invoice.expired/payment_link.expired/payout_link.expired,
  // which DO exist for other resource types). A subscription only expires
  // when its create-time `start_at` passes before the customer completes
  // authentication — this app's own subscriptions.create() call
  // (razorpay-actions.ts) never sets `start_at`, so no subscription this app
  // creates can ever reach "expired" in practice. Kept mapped anyway, purely
  // defensively, in case a status value ever shows up in the entity payload
  // of an event this app does handle.
  expired: "expired",
  completed: "completed",
};

// Fails safe: an unrecognized provider_status (a future Razorpay status
// this map hasn't been updated for, or a malformed webhook payload) never
// silently grants access — it normalizes to "suspended", the same
// no-access bucket as a known failure state, rather than defaulting to
// "active" or throwing and leaving no row written at all. The caller is
// still expected to store the raw, unrecognized provider_status verbatim
// alongside this (see subscriptions_v2.provider_status) so it's visible for
// support/debugging even when normalization had to fail closed.
export function normalizeRazorpaySubscriptionStatus(providerStatus: string): NormalizedSubscriptionStatus {
  return RAZORPAY_STATUS_MAP[providerStatus] ?? "suspended";
}
