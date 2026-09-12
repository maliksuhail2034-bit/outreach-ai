import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/db";
import {
  hasPaymentWebhookEventBeenProcessed,
  recordPaymentWebhookEventProcessed,
} from "@/lib/db/billing-v2";
import { verifyRazorpayWebhookSignature } from "@/lib/billing/razorpay";
import { syncSubscriptionFromRazorpay, type RazorpaySubscriptionEntity } from "@/lib/billing/sync-subscription-v2";

// Razorpay's SDK needs Node's crypto for signature verification (same
// reasoning app/api/webhooks/stripe/route.ts already documents for
// itself) — this can't run on the edge runtime.
export const runtime = "nodejs";

const PROVIDER = "razorpay";

// The minimal set approved for Phase 1 — see the Phase 0/final design
// review's webhook-event analysis. subscription.authenticated and
// subscription.updated are deliberately NOT in this set: authenticated
// grants no access under the approved status mapping (see
// lib/billing/razorpay-status.ts) and isn't needed for correctness yet;
// updated is a vague catch-all not needed until a plan-change/upgrade flow
// exists. Any event not in this set is acknowledged and recorded (so
// Razorpay doesn't keep retrying it) but otherwise ignored — see the
// default branch below.
const HANDLED_EVENTS = new Set([
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.paused",
  "subscription.resumed",
]);

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
  };
}

// Webhook signature verification needs the exact raw request body — this
// must never touch request.json() (or anything else that parses/re-encodes
// the body) before verifyRazorpayWebhookSignature runs, same requirement
// app/api/webhooks/stripe/route.ts documents for its own raw-body handling.
export async function POST(request: Request) {
  const signature = request.headers.get("x-razorpay-signature");
  // Razorpay delivers the event id via this header, NOT a field in the
  // JSON body — confirmed via official documentation during the Phase 0
  // design review (unlike Stripe, whose event.id lives in the body).
  const eventId = request.headers.get("x-razorpay-event-id");
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !eventId || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature, event id, or webhook secret." }, { status: 400 });
  }

  const rawBody = await request.text();

  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret)) {
    console.error("[webhooks/razorpay] signature verification failed");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Idempotency: checked (not claimed) here — recorded as processed only
  // after the handler below actually succeeds, so a transient failure
  // stays retryable. Same shape as app/api/webhooks/stripe/route.ts,
  // generalized to (provider, event_id) via payment_webhook_events.
  if (await hasPaymentWebhookEventBeenProcessed(supabase, PROVIDER, eventId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  let event: RazorpayWebhookPayload;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    console.error("[webhooks/razorpay] malformed JSON body");
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.event)) {
    // Not an event this app subscribes to handling — still acknowledged
    // and recorded so Razorpay doesn't keep retrying it, same
    // "acknowledge, don't silently drop" precedent as the Stripe webhook's
    // own default/invoice.payment_failed branches.
    await recordPaymentWebhookEventProcessed(supabase, PROVIDER, eventId, event.event);
    return NextResponse.json({ received: true });
  }

  const subscriptionEntity = event.payload.subscription?.entity;
  if (!subscriptionEntity) {
    console.error("[webhooks/razorpay] handled event missing subscription entity", event.event);
    return NextResponse.json({ error: "Missing subscription entity." }, { status: 400 });
  }

  try {
    const organizationId = await syncSubscriptionFromRazorpay(supabase, subscriptionEntity);

    // actor_user_id is null — no interactive user in a webhook. Mirrors
    // app/api/webhooks/stripe/route.ts's identical audit-logging shape for
    // its own customer.subscription.* branches.
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organization_id: organizationId,
        actor_user_id: null,
        action: "billing_subscription_changed",
        target_type: "subscription",
        target_id: subscriptionEntity.id,
        metadata: { razorpayEventType: event.event },
      });
    }
  } catch (error) {
    // Deliberately not recorded as processed — returning a non-2xx here is
    // what makes Razorpay retry this exact event instead of it being lost,
    // mirroring the Stripe webhook's identical reasoning.
    console.error("[webhooks/razorpay] handler failed", event.event, eventId, error);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  await recordPaymentWebhookEventProcessed(supabase, PROVIDER, eventId, event.event);
  return NextResponse.json({ received: true });
}
