import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function getBillingCustomer(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from("billing_customers")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Written only by the Stripe webhook handler (see lib/billing/sync-subscription.ts)
// — organization_id is unique, so this self-heals a cancel-then-resubscribe
// instead of needing separate reconciliation logic.
export async function upsertBillingCustomer(
  supabase: Client,
  organizationId: string,
  stripeCustomerId: string,
): Promise<Tables<"billing_customers">> {
  const result = await supabase
    .from("billing_customers")
    .upsert(
      { organization_id: organizationId, stripe_customer_id: stripeCustomerId },
      { onConflict: "organization_id" },
    )
    .select("*")
    .single();
  return unwrap<Tables<"billing_customers">>(result);
}

// No row means the organization is on the free plan — see
// lib/billing/resolve-plan.ts, which is the only caller that should treat
// null specially; everything else just wants "the subscription, if any".
export async function getSubscription(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Written only by the Stripe webhook handler. Upserted on organization_id
// (unique) rather than stripe_subscription_id, so a cancel-then-resubscribe
// (a new Stripe subscription object) cleanly replaces the old row.
export async function upsertSubscription(
  supabase: Client,
  values: TablesInsert<"subscriptions">,
): Promise<Tables<"subscriptions">> {
  const result = await supabase.from("subscriptions").upsert(values, { onConflict: "organization_id" }).select("*").single();
  return unwrap<Tables<"subscriptions">>(result);
}

// Checked before processing, so an already-handled event (Stripe redelivers
// on timeout, or occasionally sends the same event twice) is a no-op.
// Deliberately NOT combined with recordStripeEventProcessed into a single
// claim-then-process step: this is checked first and recorded only after
// the handler succeeds (see app/api/webhooks/stripe/route.ts), so a
// transient failure leaves the event unrecorded and Stripe's automatic
// retry can actually retry it instead of being silently skipped as a
// "duplicate".
export async function hasStripeEventBeenProcessed(supabase: Client, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("stripe_webhook_events").select("id").eq("id", id).maybeSingle();
  if (error) throw error;
  return data !== null;
}

// Called only after the event's handler has succeeded. Swallows a unique
// violation (a genuinely concurrent duplicate delivery both reaching this
// point) rather than throwing — the underlying subscription write is an
// idempotent upsert either way, so a rare race here is harmless.
export async function recordStripeEventProcessed(supabase: Client, id: string, type: string): Promise<void> {
  const { error } = await supabase.from("stripe_webhook_events").insert({ id, type });
  if (error && !isUniqueViolation(error)) throw error;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
