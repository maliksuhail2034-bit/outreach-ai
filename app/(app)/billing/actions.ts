"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getBillingCustomer, getOrCreateOrganizationForUser } from "@/lib/db";
import { getPriceId } from "@/lib/billing/plans";
import { getStripeClient } from "@/lib/billing/stripe";
import { checkoutSchema, type CheckoutInput } from "@/lib/validations/billing";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client only ever offers
// buttons for the plans/intervals actually configured (see
// components/billing/plan-list.tsx).

function getAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build Stripe redirect URLs.");
  }
  return appUrl.replace(/\/$/, "");
}

function resolveOrganizationName(userEmail: string | undefined) {
  const prefix = userEmail?.split("@")[0]?.trim();
  return `${prefix || "My"}'s workspace`;
}

// Sends the user to Stripe Checkout for a subscription. Reuses the org's
// existing Stripe Customer if the webhook has already recorded one (so
// repeat checkouts, e.g. after a cancellation, don't create a fresh
// Customer object every time); otherwise lets Checkout create one from the
// user's email. Either way, billing_customers itself is only ever written
// by the webhook handler — this action never writes it directly, see
// lib/billing/sync-subscription.ts.
export async function createCheckoutSessionAction(input: CheckoutInput) {
  const parsed = checkoutSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  const organization = await getOrCreateOrganizationForUser(supabase, user.id, resolveOrganizationName(user.email));

  const priceId = getPriceId(parsed.planId, parsed.interval);
  if (!priceId) {
    throw new Error("This plan isn't available yet. Try again shortly or contact support.");
  }

  const existingCustomer = await getBillingCustomer(supabase, organization.id);
  const appUrl = getAppUrl();

  const session = await getStripeClient().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    ...(existingCustomer
      ? { customer: existingCustomer.stripe_customer_id }
      : { customer_email: user.email }),
    client_reference_id: organization.id,
    subscription_data: { metadata: { organization_id: organization.id } },
    success_url: `${appUrl}/billing?checkout=success`,
    cancel_url: `${appUrl}/billing?checkout=cancelled`,
  });

  if (!session.url) {
    throw new Error("Stripe didn't return a checkout URL. Try again.");
  }
  redirect(session.url);
}

// Sends the user to the Stripe-hosted Customer Portal to manage/cancel
// their existing subscription — this is Stripe's own UI, not something
// this app builds a page for (see the UI scope note in
// app/(app)/billing/page.tsx).
export async function createPortalSessionAction() {
  const user = await requireUser();
  const supabase = await createClient();

  const organization = await getOrCreateOrganizationForUser(supabase, user.id, resolveOrganizationName(user.email));

  const customer = await getBillingCustomer(supabase, organization.id);
  if (!customer) {
    throw new Error("You don't have a billing account yet — subscribe to a plan first.");
  }

  const session = await getStripeClient().billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${getAppUrl()}/billing`,
  });

  redirect(session.url);
}
