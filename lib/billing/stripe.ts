import Stripe from "stripe";

let cachedClient: Stripe | null = null;

// Lazily constructed (not at module load) so importing this file never
// throws in a context where STRIPE_SECRET_KEY genuinely isn't needed yet
// (e.g. typecheck/build) — mirrors how lib/email/unsubscribe-token.ts reads
// its secret lazily inside each function rather than at import time.
export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.local — see .env.example.");
  }

  // maxNetworkRetries: the SDK's own default is 0 — a transient network
  // blip during a webhook/checkout-session call otherwise isn't retried at
  // all. 2 is Stripe's own documented recommendation; the SDK only retries
  // requests it can prove are safe to retry (idempotent GETs, and POSTs sent
  // with an idempotency key), so this can't cause a duplicate charge/side
  // effect. Reliability Track item 5.
  cachedClient = new Stripe(secretKey, { maxNetworkRetries: 2 });
  return cachedClient;
}

// Thin, testable wrapper around Stripe's own signature verification — kept
// separate from the route handler (app/api/webhooks/stripe/route.ts) so a
// tampered/forged payload rejection can be unit-tested without a network
// call, the same orchestration-wrapper split used for
// lib/email/unsubscribe.ts (logic in a plain module, the route is a thin
// caller).
export function verifyStripeWebhookSignature(payload: string, signature: string, secret: string): Stripe.Event {
  return getStripeClient().webhooks.constructEvent(payload, signature, secret);
}
