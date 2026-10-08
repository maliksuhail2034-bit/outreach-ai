import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Provider-agnostic V2 billing helpers (billing_customers_v2/
// subscriptions_v2/payment_webhook_events) — kept entirely separate from
// lib/db/billing.ts's existing Stripe-facing functions per the approved
// architecture (that file, and the legacy billing_customers/subscriptions/
// stripe_webhook_events tables it reads/writes, are not touched by this
// phase). Currently only exercised by the Razorpay webhook route, but
// nothing here is Razorpay-specific — a future PayPal integration reuses
// these same functions unchanged.

export async function getBillingCustomerV2(
  supabase: Client,
  organizationId: string,
  provider: string,
): Promise<Tables<"billing_customers_v2"> | null> {
  const { data, error } = await supabase
    .from("billing_customers_v2")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Written only by webhook handlers (never a checkout action) — see the
// Phase 1 architecture decision that the database must represent
// webhook-confirmed provider state, not assumptions made during checkout
// creation. Upserted on (organization_id, provider): unlike the legacy
// billing_customers (unique on organization_id alone, since it only ever
// held one Stripe customer), an organization can now hold one customer row
// per provider (see the Phase A migration's own comment on
// billing_customers_v2).
export async function upsertBillingCustomerV2(
  supabase: Client,
  values: TablesInsert<"billing_customers_v2">,
): Promise<Tables<"billing_customers_v2">> {
  const result = await supabase
    .from("billing_customers_v2")
    .upsert(values, { onConflict: "organization_id,provider" })
    .select("*")
    .single();
  return unwrap<Tables<"billing_customers_v2">>(result);
}

// No row means the organization has no confirmed Razorpay/PayPal
// subscription yet — callers that need "the current plan" should go through
// lib/billing/resolve-plan.ts's getPlanForOrganization() (which reads both
// this table and the legacy Stripe `subscriptions` table via
// subscription-view.ts), not this function directly. This one is only for
// the Razorpay checkout action's duplicate-prevention check and the
// webhook's own upsert-by-organization_id below.
export async function getSubscriptionV2(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from("subscriptions_v2")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Written only by webhook handlers. Upserted on organization_id (unique
// regardless of provider, per the Phase A migration's
// subscriptions_v2_organization_id_key constraint) — same self-healing
// cancel-then-resubscribe behavior as the legacy upsertSubscription, and
// the same DB-level backstop against two confirmed subscription rows ever
// coexisting for one organization.
export async function upsertSubscriptionV2(
  supabase: Client,
  values: TablesInsert<"subscriptions_v2">,
): Promise<Tables<"subscriptions_v2">> {
  const result = await supabase
    .from("subscriptions_v2")
    .upsert(values, { onConflict: "organization_id" })
    .select("*")
    .single();
  return unwrap<Tables<"subscriptions_v2">>(result);
}

// Checked before processing, so an already-handled event (a provider
// redelivers on timeout, or occasionally sends the same event twice) is a
// no-op — same idempotency shape as lib/db/billing.ts's
// hasStripeEventBeenProcessed, generalized to (provider, event_id) since
// this ledger is shared across every payment provider.
export async function hasPaymentWebhookEventBeenProcessed(
  supabase: Client,
  provider: string,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .select("event_id")
    .eq("provider", provider)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

// Called only after the event's handler has succeeded — same "recorded
// only on success, so a transient failure stays retryable" discipline as
// lib/db/billing.ts's recordStripeEventProcessed. Swallows a unique
// violation (a genuinely concurrent duplicate delivery both reaching this
// point) rather than throwing, for the same reason that function does.
export async function recordPaymentWebhookEventProcessed(
  supabase: Client,
  provider: string,
  eventId: string,
  eventType: string,
): Promise<void> {
  const { error } = await supabase
    .from("payment_webhook_events")
    .insert({ provider, event_id: eventId, event_type: eventType });
  if (error && !isUniqueViolation(error)) throw error;
}

// billing_checkouts: the organization's single open checkout (see
// supabase/migrations/20261007100000_billing_checkouts.sql). claim/attach/
// release run with the user's own session — the functions check membership
// against auth.uid() themselves. Only completeBillingCheckout runs as the
// service role (from the webhook).
//
// claimToken is the private capability attach/release require. It only ever
// lives in the server action that made the claim: never log it, put it in an
// error, or return it to the browser.

export type BillingCheckoutClaim =
  | { outcome: "claimed"; checkoutId: string; claimToken: string }
  // providerSubscriptionId is null while another request is still creating it.
  | { outcome: "existing"; checkoutId: string; providerSubscriptionId: string | null }
  | { outcome: "conflict" };

export async function claimBillingCheckout(
  supabase: Client,
  values: { organizationId: string; internalPlanId: string; billingInterval: string; currency: string },
): Promise<BillingCheckoutClaim> {
  const { data, error } = await supabase
    .rpc("claim_billing_checkout", {
      p_organization_id: values.organizationId,
      p_internal_plan_id: values.internalPlanId,
      p_billing_interval: values.billingInterval,
      p_currency: values.currency,
    })
    .single();
  if (error) throw error;

  switch (data.claim_outcome) {
    case "claimed":
      if (!data.claim_token) throw new Error("Checkout claim returned no claim token.");
      return { outcome: "claimed", checkoutId: data.checkout_id, claimToken: data.claim_token };
    case "existing":
      return { outcome: "existing", checkoutId: data.checkout_id, providerSubscriptionId: data.checkout_subscription_id };
    case "conflict":
      return { outcome: "conflict" };
    default:
      throw new Error(`Unexpected checkout claim outcome: ${data.claim_outcome}`);
  }
}

export async function attachBillingCheckoutSubscription(
  supabase: Client,
  claim: { checkoutId: string; claimToken: string },
  providerSubscriptionId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("attach_billing_checkout_subscription", {
    p_checkout_id: claim.checkoutId,
    p_claim_token: claim.claimToken,
    p_provider_subscription_id: providerSubscriptionId,
  });
  if (error) throw error;
  return data;
}

export async function releaseBillingCheckout(
  supabase: Client,
  claim: { checkoutId: string; claimToken: string },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("release_billing_checkout", {
    p_checkout_id: claim.checkoutId,
    p_claim_token: claim.claimToken,
  });
  if (error) throw error;
  return data;
}

// Service role only (the webhook). Marks the open checkout that created this
// subscription completed; a no-op when there is none (a subscription created
// before billing_checkouts existed, or one already completed/expired).
export async function completeBillingCheckout(
  supabase: Client,
  provider: string,
  providerSubscriptionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("billing_checkouts")
    .update({ status: "completed" })
    .eq("provider", provider)
    .eq("provider_subscription_id", providerSubscriptionId)
    .eq("status", "open");
  if (error) throw error;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
