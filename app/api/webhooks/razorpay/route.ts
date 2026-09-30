import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/db";
import {
  hasPaymentWebhookEventBeenProcessed,
  recordPaymentWebhookEventProcessed,
} from "@/lib/db/billing-v2";
import { getRazorpayClient, verifyRazorpayWebhookSignature } from "@/lib/billing/razorpay";
import {
  syncSubscriptionFromRazorpay,
  toRazorpaySubscriptionEntity,
  type RazorpaySubscriptionEntity,
  type RazorpaySyncResult,
} from "@/lib/billing/sync-subscription-v2";
import { captureError } from "@/lib/monitoring/error-tracking";

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
//
// There is deliberately no "subscription.expired" here — confirmed directly
// against razorpay.com/docs/webhooks/subscriptions and .../subscriptions/
// states that no such event exists (see lib/billing/razorpay-status.ts's
// `expired` entry for the full citation and why it's unreachable for this
// app's subscriptions regardless).
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
    subscription?: { entity?: Partial<RazorpaySubscriptionEntity> };
  };
}

// Ids and statuses only — never customer or payment details — same rule as
// every other captureError call site.
async function reportFailure(message: string, context: Record<string, unknown>): Promise<void> {
  console.error("[webhooks/razorpay]", message, context);
  await captureError({ job: "razorpay-webhook", message, context });
}

async function reportSyncOutcome(result: RazorpaySyncResult, context: Record<string, unknown>): Promise<void> {
  switch (result.outcome) {
    case "unmapped":
      await reportFailure("subscription notes don't identify an organization/plan/interval — not synced", context);
      return;
    case "skipped_other_current_subscription": {
      const details = { ...context, organizationId: result.organizationId, currentSubscriptionId: result.currentSubscriptionId };
      if (result.incomingNonTerminal) {
        await reportFailure("organization already has a different live subscription — not overwritten", details);
      } else {
        console.warn("[webhooks/razorpay] ignored an ended subscription that is no longer the organization's current one", details);
      }
      return;
    }
    case "synced":
      if (result.unrecognizedStatus) {
        await reportFailure("unrecognized Razorpay subscription status — stored as suspended (no access)", {
          ...context,
          organizationId: result.organizationId,
        });
      }
      return;
  }
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    await reportFailure("signed webhook body is not valid JSON", { eventId });
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }
  // Valid JSON isn't necessarily an event object (`null`, a number, an
  // array) — reject those here rather than throwing at event.event below.
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as { event?: unknown }).event !== "string"
  ) {
    await reportFailure("signed webhook body is not a Razorpay event object", { eventId });
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }
  const event = parsed as RazorpayWebhookPayload;

  if (!HANDLED_EVENTS.has(event.event)) {
    // Not an event this app subscribes to handling — still acknowledged
    // and recorded so Razorpay doesn't keep retrying it, same
    // "acknowledge, don't silently drop" precedent as the Stripe webhook's
    // own default/invoice.payment_failed branches.
    await recordPaymentWebhookEventProcessed(supabase, PROVIDER, eventId, event.event);
    return NextResponse.json({ received: true });
  }

  const subscriptionId = event.payload?.subscription?.entity?.id;
  const context = { eventId, eventType: event.event, subscriptionId };
  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
    await reportFailure("handled event has no subscription id", context);
    return NextResponse.json({ error: "Missing subscription entity." }, { status: 400 });
  }

  // The payload is only used to learn WHICH subscription changed; its state
  // is re-fetched from Razorpay and that is what gets written. Deliveries
  // can arrive late or out of order (a retried subscription.charged after a
  // subscription.cancelled), and the event-id header used for dedup above
  // is not covered by the signature — so a signed body replayed under a new
  // id passes dedup. Writing the provider's current state makes both
  // harmless: every delivery, however stale, writes the same current truth.
  let subscription: RazorpaySubscriptionEntity;
  try {
    subscription = toRazorpaySubscriptionEntity(await getRazorpayClient().subscriptions.fetch(subscriptionId));
  } catch (error) {
    console.error("[webhooks/razorpay] re-fetch failed", context, error);
    await reportFailure("couldn't re-fetch subscription from Razorpay — will retry", context);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  if (subscription.id !== subscriptionId) {
    await reportFailure("Razorpay returned a different subscription than requested — not synced", {
      ...context,
      fetchedSubscriptionId: subscription.id,
    });
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  let result: RazorpaySyncResult;
  try {
    result = await syncSubscriptionFromRazorpay(supabase, subscription);

    // actor_user_id is null — no interactive user in a webhook. Mirrors
    // app/api/webhooks/stripe/route.ts's identical audit-logging shape for
    // its own customer.subscription.* branches.
    if (result.outcome === "synced") {
      await recordAuditEvent(supabase, {
        organization_id: result.organizationId,
        actor_user_id: null,
        action: "billing_subscription_changed",
        target_type: "subscription",
        target_id: subscription.id,
        metadata: { razorpayEventType: event.event, razorpayStatus: subscription.status },
      });
    }
  } catch (error) {
    // Deliberately not recorded as processed — returning a non-2xx here is
    // what makes Razorpay retry this exact event instead of it being lost,
    // mirroring the Stripe webhook's identical reasoning.
    console.error("[webhooks/razorpay] sync failed", context, error);
    await reportFailure("subscription sync failed — will retry", context);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  // Unmapped and skipped outcomes are acknowledged, not retried: a retry
  // would re-fetch the same provider state and reach the same outcome, so
  // they're alerted for a person instead.
  await reportSyncOutcome(result, { ...context, razorpayStatus: subscription.status });

  await recordPaymentWebhookEventProcessed(supabase, PROVIDER, eventId, event.event);
  return NextResponse.json({ received: true });
}
