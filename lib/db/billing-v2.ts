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

// No row means the organization has no confirmed subscription on any
// provider yet — callers that need "the current plan" during this phase
// should keep reading the legacy `subscriptions` table via
// lib/billing/resolve-plan.ts (untouched); this is only for the Razorpay
// checkout action's duplicate-prevention check and the webhook's own
// upsert-by-organization_id below.
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
