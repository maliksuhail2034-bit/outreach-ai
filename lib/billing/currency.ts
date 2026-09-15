// Currency-aware money handling for Polimatiq's billing. USD remains the
// sole canonical/marketing product price (see lib/billing/plans.ts) — INR
// exists only as a controlled, deterministic derivation of that same USD
// price for the Razorpay India payment rail (UPI/Indian cards/netbanking
// cannot process a USD-denominated Razorpay Plan — see the Razorpay
// architecture investigation this module implements). INR is never a
// second, independently-set marketing price.

export type Currency = "USD" | "INR";

// Fixed, deterministic USD->INR basis — approved 2026-09-15 against a
// then-current market spot of ~95.8, not a live FX rate. Deliberately NOT
// looked up per-checkout: a subscription's INR amount must stay stable for
// its lifetime, not drift with daily market movement (a customer's renewal
// charging a different rupee amount than their first payment would be a
// billing surprise). Revisit only via a deliberate, approved change to this
// constant — never an automatic/live conversion.
export const USD_TO_INR_RATE = 96;

// USD cents -> INR paise at the fixed rate above. Both currencies use the
// same 2-decimal smallest-unit convention (cents/paise), so this is a
// single integer multiplication — no floating-point risk beyond what
// lib/billing/pricing.ts's calculateIntervalPrice already guards against
// for the USD figure this is derived from.
export function usdCentsToInrPaise(usdCents: number): number {
  return usdCents * USD_TO_INR_RATE;
}

// Which currency a given payment route charges in. Only the two routes this
// app actually has (or is actively building) are listed — not a
// speculative full provider matrix. "razorpay_india" is live;
// "international" (Razorpay International and/or PayPal, both USD) is not
// implemented yet, but already needs a currency answer for the pricing
// architecture above it.
export type PaymentRoute = "razorpay_india" | "international";

export const ROUTE_CURRENCY: Record<PaymentRoute, Currency> = {
  razorpay_india: "INR",
  international: "USD",
};

const CURRENCY_FORMATTERS: Record<Currency, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
  INR: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }),
};

// smallestUnit (cents or paise) -> locale-correct formatted string, e.g.
// formatMoney(1200, "USD") -> "$12.00", formatMoney(16496640, "INR") ->
// "₹1,64,966.40" (Indian digit grouping, via Intl — not hand-rolled).
// Additive: existing USD displays keep using lib/billing/pricing.ts's
// formatCents() unchanged (its plain "$12.00" style has existing call
// sites/tests depending on it) — this is the one place a NEW
// currency-aware display (starting with the Razorpay INR checkout
// disclosure) should call instead of hardcoding a "$"/"₹" prefix.
export function formatMoney(amountInSmallestUnit: number, currency: Currency): string {
  return CURRENCY_FORMATTERS[currency].format(amountInSmallestUnit / 100);
}
