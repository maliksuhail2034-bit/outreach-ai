import { BILLING_INTERVALS, type BillingInterval } from "./plans";

// Pure pricing math — no database access, no Stripe call, nothing that
// depends on which plan/interval combinations actually have a configured
// Stripe price id yet. Kept separate from plans.ts so the arithmetic is
// unit-testable on its own, same reasoning lib/warmup/scoring.ts and
// lib/warmup/stats.ts already follow.
//
// All amounts are in cents throughout (matching Plan.launchPriceCents/
// regularPriceCents in plans.ts, and Stripe's own unit_amount convention)
// specifically to avoid floating-point drift: 12 * 3 * 0.95 in plain
// JS-float dollars is 34.199999999999996, not 34.2. Working in integer
// cents with a single Math.round at the end keeps the result exact.

const MONTHS_PER_INTERVAL: Record<BillingInterval, number> = {
  "1_month": 1,
  "3_month": 3,
  "6_month": 6,
  "12_month": 12,
};

// Applied to the launch price, never the regular price — per the pricing
// spec, the crossed-out regular price is display-only and never enters a
// discount calculation.
const DISCOUNT_FRACTION: Record<BillingInterval, number> = {
  "1_month": 0,
  "3_month": 0.05,
  "6_month": 0.1,
  "12_month": 0.2,
};

export function monthsForInterval(interval: BillingInterval): number {
  return MONTHS_PER_INTERVAL[interval];
}

export function discountPercentForInterval(interval: BillingInterval): number {
  return DISCOUNT_FRACTION[interval] * 100;
}

export interface IntervalPriceBreakdown {
  interval: BillingInterval;
  months: number;
  // 0, 5, 10, or 20.
  discountPercent: number;
  // launchPriceCents * months, before the interval discount — what the
  // customer would otherwise pay at the launch monthly rate for this many
  // months. Shown struck through alongside totalCents where a discount
  // applies.
  undiscountedTotalCents: number;
  // What the customer is actually charged for the full duration.
  totalCents: number;
  // undiscountedTotalCents - totalCents. 0 at 1 month.
  savingsCents: number;
  // totalCents / months, rounded — the effective per-month rate at this
  // duration, for an "equivalent to $X/mo" display.
  effectiveMonthlyCents: number;
}

// The one function every pricing display (billing UI's duration selector,
// the marketing pricing page once it shows real amounts) should call —
// never re-derive this arithmetic inline at a call site.
export function calculateIntervalPrice(launchPriceCents: number, interval: BillingInterval): IntervalPriceBreakdown {
  const months = monthsForInterval(interval);
  const discountPercent = discountPercentForInterval(interval);
  const undiscountedTotalCents = launchPriceCents * months;
  const totalCents = Math.round(undiscountedTotalCents * (1 - DISCOUNT_FRACTION[interval]));

  return {
    interval,
    months,
    discountPercent,
    undiscountedTotalCents,
    totalCents,
    savingsCents: undiscountedTotalCents - totalCents,
    effectiveMonthlyCents: Math.round(totalCents / months),
  };
}

// Every duration's breakdown for one plan's launch price, in
// BILLING_INTERVALS order — what a duration selector renders in one pass
// rather than calling calculateIntervalPrice once per option inline.
export function calculateAllIntervalPrices(launchPriceCents: number): IntervalPriceBreakdown[] {
  return BILLING_INTERVALS.map((interval) => calculateIntervalPrice(launchPriceCents, interval));
}

// cents -> "$12.00"/"$34.20" — whole-dollar amounts still show ".00" so a
// duration selector's prices stay visually aligned; USD only, matching
// every other price in this codebase today (no multi-currency support yet).
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
