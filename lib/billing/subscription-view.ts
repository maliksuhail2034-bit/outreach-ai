import type { Tables } from "@/types/database.types";
import type { Client } from "@/lib/db/shared";
import { getSubscription } from "@/lib/db/billing";
import { getSubscriptionV2 } from "@/lib/db/billing-v2";
import { getPlanByPriceId, PAID_PLAN_IDS, type PaidPlanId, type PlanId } from "./plans";

// The single, provider-agnostic subscription read layer — see
// lib/billing/resolve-plan.ts (which resolves the Plan an organization is
// actually entitled to) and app/(app)/billing/page.tsx (which displays
// subscription status/period info), both of which read exclusively through
// getActiveSubscriptionView() below rather than each independently
// re-deriving provider precedence, status normalization, or access
// determination. Doing that in two places is exactly how the billing page
// silently stopped reflecting Razorpay subscriptions in Phase 1 — see the
// Phase 2 architecture audit.

// Canonical, provider-agnostic status vocabulary — deliberately a superset
// of lib/billing/razorpay-status.ts's own NormalizedSubscriptionStatus
// (which has no "trialing": a Stripe-only concept a Razorpay subscription
// in this app never produces). Not imported from that file: that module's
// type only needs to describe what normalizeRazorpaySubscriptionStatus can
// actually produce for subscriptions_v2.normalized_status, which is
// already always a valid value of this wider type. This is Phase 2's own
// vocabulary for presenting ONE status language across both providers to
// the billing UI and plan resolution.
export type NormalizedSubscriptionStatus =
  | "pending"
  | "active"
  | "trialing"
  | "past_due"
  | "suspended"
  | "cancelled"
  | "expired"
  | "completed";

// The only statuses, once normalized into the vocabulary above, that still
// grant the plan's access — mirrors lib/billing/resolve-plan.ts's legacy
// ACTIVE_STATUSES set exactly (same dunning-window reasoning for
// past_due), extended with "trialing" for parity now that it's part of the
// shared vocabulary instead of a legacy-only concept.
const GRANTING_STATUSES = new Set<NormalizedSubscriptionStatus>(["active", "trialing", "past_due"]);

const NORMALIZED_STATUSES = new Set<NormalizedSubscriptionStatus>([
  "pending",
  "active",
  "trialing",
  "past_due",
  "suspended",
  "cancelled",
  "expired",
  "completed",
]);

function isNormalizedStatus(value: string): value is NormalizedSubscriptionStatus {
  return NORMALIZED_STATUSES.has(value as NormalizedSubscriptionStatus);
}

function isPaidPlanId(value: string): value is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(value);
}

export interface SubscriptionView {
  planId: PlanId;
  provider: "stripe" | "razorpay" | "paypal" | null;
  normalizedStatus: NormalizedSubscriptionStatus | null;
  grantsAccess: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

// Legacy (Stripe-shaped) subscriptions.status -> canonical vocabulary.
// Note the spelling: legacy stores the American "canceled"; the canonical
// vocabulary (matching subscriptions_v2.normalized_status, which Razorpay's
// webhook already writes) uses "cancelled". Every consumer of
// SubscriptionView must read only this one, canonical spelling.
const LEGACY_STATUS_MAP: Record<string, NormalizedSubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  incomplete: "pending",
  unpaid: "suspended",
  paused: "suspended",
  canceled: "cancelled",
  incomplete_expired: "expired",
};

// Fails closed exactly like lib/billing/razorpay-status.ts's
// normalizeRazorpaySubscriptionStatus does for an unrecognized raw status:
// an unmapped legacy status must never grant access.
function normalizeLegacyStatus(status: string): NormalizedSubscriptionStatus {
  return LEGACY_STATUS_MAP[status] ?? "suspended";
}

// One normalized shape both providers resolve into before precedence is
// applied — never exposed outside this module (SubscriptionView is the
// public shape); updatedAt exists only to break a tie when neither
// candidate grants access (see getActiveSubscriptionView's Step 4C).
interface ResolvedCandidate {
  provider: "stripe" | "razorpay" | "paypal";
  planId: PlanId;
  normalizedStatus: NormalizedSubscriptionStatus;
  grantsAccess: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
}

function resolveLegacyCandidate(subscription: Tables<"subscriptions">): ResolvedCandidate {
  const normalizedStatus = normalizeLegacyStatus(subscription.status);
  const statusGrants = GRANTING_STATUSES.has(normalizedStatus);
  // Same fail-closed-to-free precedent the previous getPlanForOrganization
  // already had (see the regression test for it): a status that grants
  // access but whose price id this environment doesn't recognize (a price
  // removed from lib/billing/plans.ts, or a stale/test price) must still
  // resolve to no real plan, not a guess. grantsAccess reflects the final,
  // resolved outcome (never true alongside planId "free") rather than the
  // status check alone, so a SubscriptionView reader never sees a
  // self-contradictory combination of the two fields.
  const plan = statusGrants ? getPlanByPriceId(subscription.stripe_price_id) : null;

  return {
    provider: "stripe",
    planId: plan?.id ?? "free",
    normalizedStatus,
    grantsAccess: plan !== null,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: subscription.updated_at,
  };
}

function resolveV2Candidate(subscription: Tables<"subscriptions_v2">): ResolvedCandidate | null {
  // Defensive only — subscriptions_v2.provider has a DB CHECK constraint
  // limiting it to 'stripe' | 'razorpay' | 'paypal', so this should be
  // unreachable in practice. Kept anyway per the fail-closed requirement:
  // an unrecognized provider value must never be asserted through.
  if (subscription.provider !== "stripe" && subscription.provider !== "razorpay" && subscription.provider !== "paypal") {
    console.warn(`[billing] subscriptions_v2 row ${subscription.id} has an unrecognized provider — ignoring it.`);
    return null;
  }

  // Also defensive — normalized_status/internal_plan_id both have DB CHECK
  // constraints already limiting them to known values; validated again
  // here because the generated TypeScript type widens both to plain
  // string, and an unrecognized/malformed value must fail closed rather
  // than being asserted through.
  const normalizedStatus = isNormalizedStatus(subscription.normalized_status)
    ? subscription.normalized_status
    : "suspended";
  const statusGrants = GRANTING_STATUSES.has(normalizedStatus);
  const planId = statusGrants && isPaidPlanId(subscription.internal_plan_id) ? subscription.internal_plan_id : "free";

  return {
    provider: subscription.provider,
    planId,
    normalizedStatus,
    grantsAccess: planId !== "free",
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: subscription.updated_at,
  };
}

function toView(candidate: ResolvedCandidate): SubscriptionView {
  return {
    planId: candidate.planId,
    provider: candidate.provider,
    normalizedStatus: candidate.normalizedStatus,
    grantsAccess: candidate.grantsAccess,
    currentPeriodEnd: candidate.currentPeriodEnd,
    cancelAtPeriodEnd: candidate.cancelAtPeriodEnd,
  };
}

// The only place this app decides "what subscription, across every
// provider, actually governs this organization's plan and billing display"
// — see the module comment above. Deliberately does NOT implement
// "subscriptions_v2 always wins": that would risk silently downgrading an
// organization with a genuinely active legacy Stripe subscription the
// moment any non-granting subscriptions_v2 row exists for it (e.g. a
// cancelled-after-activating Razorpay attempt). See the Phase 2
// architecture audit's precedence-question section for the full reasoning.
export async function getActiveSubscriptionView(supabase: Client, organizationId: string): Promise<SubscriptionView> {
  const [legacy, v2] = await Promise.all([
    getSubscription(supabase, organizationId),
    getSubscriptionV2(supabase, organizationId),
  ]);

  const legacyCandidate = legacy ? resolveLegacyCandidate(legacy) : null;
  const v2Candidate = v2 ? resolveV2Candidate(v2) : null;

  // Step 4D: neither subscription exists at all.
  if (!legacyCandidate && !v2Candidate) {
    return { planId: "free", provider: null, normalizedStatus: null, grantsAccess: false, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  }

  const legacyGrants = legacyCandidate?.grantsAccess ?? false;
  const v2Grants = v2Candidate?.grantsAccess ?? false;

  // Step 4A: exactly one grants access.
  if (legacyGrants && !v2Grants) return toView(legacyCandidate!);
  if (v2Grants && !legacyGrants) return toView(v2Candidate!);

  // Step 4B: both grant access — an anomalous double-subscription. Prefer
  // v2 (the actively-developed forward path) but surface it operationally
  // rather than resolving it silently; never throws or blocks the user.
  if (legacyGrants && v2Grants) {
    console.warn(
      `[billing] organization ${organizationId} has both a granting legacy Stripe subscription and a granting Razorpay subscription — preferring the Razorpay (v2) subscription.`,
    );
    return toView(v2Candidate!);
  }

  // Step 4C: neither grants access. The plan resolves to free either way;
  // for display, prefer whichever record was most recently updated rather
  // than an arbitrary one, using each row's own updated_at (never an
  // invented timestamp).
  const displayCandidate =
    legacyCandidate && v2Candidate
      ? legacyCandidate.updatedAt >= v2Candidate.updatedAt
        ? legacyCandidate
        : v2Candidate
      : (legacyCandidate ?? v2Candidate)!;

  return {
    planId: "free",
    provider: displayCandidate.provider,
    normalizedStatus: displayCandidate.normalizedStatus,
    grantsAccess: false,
    currentPeriodEnd: displayCandidate.currentPeriodEnd,
    cancelAtPeriodEnd: displayCandidate.cancelAtPeriodEnd,
  };
}
