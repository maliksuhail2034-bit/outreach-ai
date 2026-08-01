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

  cachedClient = new Stripe(secretKey);
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
