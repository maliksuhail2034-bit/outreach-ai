import type Stripe from "stripe";
import type { Client } from "@/lib/db/shared";
import { getBillingCustomer, upsertBillingCustomer, upsertSubscription } from "@/lib/db/billing";

// Resolves which organization a Stripe subscription belongs to.
// subscription.metadata.organization_id is set at checkout time (see
// createCheckoutSessionAction's subscription_data.metadata) and is the
// reliable path; billing_customers is the fallback for events where that
// metadata didn't propagate (defense in depth, not the primary path).
async function resolveOrganizationId(supabase: Client, subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.organization_id;
  if (fromMetadata) return fromMetadata;

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const { data, error } = await supabase
    .from("billing_customers")
    .select("organization_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data?.organization_id ?? null;
}

// The single place that writes subscription state from a Stripe object —
// called for checkout.session.completed (with a known organizationId) and
// for every customer.subscription.* event (created/updated/deleted all
// carry the subscription's full current state, so one function correctly
// handles upgrades, downgrades, renewals, and cancellations: there's
// nothing "special" about any of them from this function's point of view,
// they're all just "here is the subscription's current state, persist it").
//
// Returns the resolved organizationId (or null if it couldn't be resolved)
// rather than void — app/api/webhooks/stripe/route.ts needs it to record a
// billing_subscription_changed audit event after this returns, and for the
// customer.subscription.* branch that id is only known inside this function
// (resolveOrganizationId above), not the caller.
export async function syncSubscriptionFromStripe(
  supabase: Client,
  subscription: Stripe.Subscription,
  knownOrganizationId?: string,
): Promise<string | null> {
  const organizationId = knownOrganizationId ?? (await resolveOrganizationId(supabase, subscription));
  if (!organizationId) {
    console.error("[stripe] couldn't resolve an organization for subscription", subscription.id);
    return null;
  }

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) {
    console.error("[stripe] subscription has no price on its first item", subscription.id);
    return null;
  }

  // current_period_end lives on the subscription item, not the
  // subscription itself, as of this SDK's API version.
  const periodEndSeconds = subscription.items.data[0]?.current_period_end;

  const existingCustomer = await getBillingCustomer(supabase, organizationId);
  if (!existingCustomer || existingCustomer.stripe_customer_id !== customerId) {
    await upsertBillingCustomer(supabase, organizationId, customerId);
  }

  await upsertSubscription(supabase, {
    organization_id: organizationId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    status: subscription.status,
    current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
  });

  return organizationId;
}
