import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasStripeEventBeenProcessed, recordStripeEventProcessed } from "@/lib/db/billing";
import { getStripeClient, verifyStripeWebhookSignature } from "@/lib/billing/stripe";
import { syncSubscriptionFromStripe } from "@/lib/billing/sync-subscription";

// Stripe's SDK needs Node's crypto for signature verification, and the
// handler makes real API calls (subscriptions.retrieve) — same runtime
// requirement as the cron routes, for the same reason (this can't run on
// the edge runtime).
export const runtime = "nodejs";

// Webhook signature verification needs the exact raw request body — this
// must never touch request.json() (or anything else that parses/re-encodes
// the body) before verifyStripeWebhookSignature runs, or the signature
// check will fail even for a genuine Stripe request.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or webhook secret." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature.";
    console.error("[webhooks/stripe] signature verification failed", message);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Idempotency: Stripe redelivers on timeout/non-2xx, and the same event
  // can occasionally arrive twice even without a retry. Skip re-processing
  // instead of assuming exactly-once delivery — still return 200 so Stripe
  // doesn't keep retrying an event that's already been handled. Checked
  // (not claimed) here — recorded as processed only after the handler
  // below actually succeeds, so a transient failure stays retryable.
  if (await hasStripeEventBeenProcessed(supabase, event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const organizationId = session.client_reference_id;
        if (!session.subscription || !organizationId) break;

        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
        await syncSubscriptionFromStripe(supabase, subscription, organizationId);
        break;
      }

      // created/updated/deleted all carry the subscription's full current
      // state — upgrades, downgrades, renewals, and cancellations
      // (immediate or scheduled via cancel_at_period_end) are all just
      // "persist what Stripe says this subscription looks like now".
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscriptionFromStripe(supabase, event.data.object);
        break;
      }

      // No DB write needed: Stripe also sends customer.subscription.updated
      // (status -> past_due, or later unpaid/canceled) alongside a failed
      // renewal invoice, which is what actually updates stored state. This
      // case exists so the event is acknowledged deliberately, not silently
      // dropped by the default branch.
      case "invoice.payment_failed":
        break;

      default:
        break;
    }
  } catch (error) {
    // Deliberately not recorded as processed — returning a non-2xx here is
    // what makes Stripe retry this exact event instead of it being lost.
    console.error("[webhooks/stripe] handler failed", event.type, event.id, error);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  await recordStripeEventProcessed(supabase, event.id, event.type);
  return NextResponse.json({ received: true });
}
