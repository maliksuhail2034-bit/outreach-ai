import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "crypto";
import type { BillingInterval } from "./plans";

let cachedClient: Razorpay | null = null;

// Lazily constructed (not at module load), same reasoning as
// lib/billing/stripe.ts's getStripeClient() — importing this file must
// never throw in a context where Razorpay credentials genuinely aren't
// needed yet (e.g. typecheck/build). NEXT_PUBLIC_RAZORPAY_KEY_ID is read
// here (not a separate server-only RAZORPAY_KEY_ID) deliberately — the Key
// ID is public by design (it's also read client-side to open Checkout, see
// components/billing/razorpay-checkout-button.tsx), so one env var is the
// single source of truth instead of two that could drift out of sync.
export function getRazorpayClient(): Razorpay {
  if (cachedClient) return cachedClient;

  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "NEXT_PUBLIC_RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not set. Add them to .env.local — see .env.example.",
    );
  }

  cachedClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return cachedClient;
}

// Razorpay's own SDK ships Razorpay.validateWebhookSignature(), but it
// compares digests with a plain `===` (see node_modules/razorpay/dist/
// utils/razorpay-utils.js) — not constant-time. This repo already has an
// established constant-time HMAC pattern for exactly this kind of check
// (lib/email/unsubscribe-token.ts, lib/monitoring/run-cron-job.ts's
// isAuthorized()), so this reimplements the same HMAC-SHA256 scheme
// Razorpay documents (X-Razorpay-Signature = hex HMAC-SHA256 of the raw
// request body) using timingSafeEqual instead of trusting the SDK's
// non-constant-time compare. Mirrors
// lib/billing/stripe.ts's verifyStripeWebhookSignature in spirit: a thin,
// independently-testable wrapper kept separate from the route handler.
export function verifyRazorpayWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(signature, "hex");
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — a forged/malformed signature is exactly the case this needs to
  // handle without throwing, so length is checked first (same pattern as
  // lib/email/unsubscribe-token.ts's verifyUnsubscribeToken).
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

// Razorpay's Create Subscription API requires an explicit total_count
// (number of billing cycles) — confirmed via the installed SDK's own types
// (Subscriptions.RazorpaySubscriptionBaseRequestBody) — unlike Stripe,
// there is no "renews indefinitely" option. Polimatiq's subscriptions are
// open-ended, not fixed-duration, so this picks a cycle count equivalent to
// 100 years at each interval's own cadence: long enough that a real
// subscription will never actually reach Razorpay's `completed` status,
// short enough to stay a small, unremarkable integer. This is a Phase 1
// design decision (not dictated by Razorpay or the approved architecture
// doc) — documented here rather than left as an unexplained magic number.
const CYCLES_FOR_100_YEARS: Record<BillingInterval, number> = {
  "1_month": 1200,
  "3_month": 400,
  "6_month": 200,
  "12_month": 100,
};

export function totalCountForInterval(interval: BillingInterval): number {
  return CYCLES_FOR_100_YEARS[interval];
}
