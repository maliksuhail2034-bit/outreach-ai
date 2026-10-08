import { BILLING_INTERVALS, PAID_PLAN_IDS, PLANS, type BillingInterval, type PaidPlanId } from "./plans";
import {
  calculateIntervalPrice,
  calculateIntervalPriceInrPaise,
  formatPlanPrice,
  type DisplayPlanPrice,
} from "./pricing";
import { formatMoney, type Currency } from "./currency";

// The one place a plan + interval + payment currency resolves to what is
// sold: the amount charged, how it's displayed, the Razorpay plan that
// charges it, and whether it can be bought at all. The billing page, the
// marketing pricing preview, the checkout action and the webhook's plan
// check all read from here, so they can't disagree.
//
// Two currencies, deliberately kept apart:
// - DISPLAY currency is always USD. `price` is the USD catalog price, the
//   same for every visitor.
// - PAYMENT currency is INR in India and USD everywhere else (decided by
//   lib/billing/region.ts). `currency`/`amount`/`razorpayPlanId` are the
//   payment side. When the payment currency isn't USD, `chargedAs` discloses
//   the exact amount Razorpay will charge, formatted from `amount` itself.
//
// Server-only in practice: Razorpay plan ids come from server-only env vars,
// so in the browser every plan would read as not configured. Client
// components get PlanOfferingView (no plan id) from a Server Component.

// Razorpay plans are created by hand in the Razorpay Dashboard and their
// ids set as env vars — this app never creates or guesses them:
//   INR: RAZORPAY_PLAN_<PLAN>_<INTERVAL>      (e.g. RAZORPAY_PLAN_STARTER_1MONTH)
//   USD: RAZORPAY_PLAN_<PLAN>_<INTERVAL>_USD  (e.g. RAZORPAY_PLAN_STARTER_1MONTH_USD)
// The INR names predate USD support and are already set in production, so
// they keep their unsuffixed form.
const INTERVAL_ENV_SUFFIX: Record<BillingInterval, string> = {
  "1_month": "1MONTH",
  "3_month": "3MONTH",
  "6_month": "6MONTH",
  "12_month": "12MONTH",
};

const CURRENCY_ENV_SUFFIX: Record<Currency, string> = {
  INR: "",
  USD: "_USD",
};

export function razorpayPlanEnvVar(planId: PaidPlanId, interval: BillingInterval, currency: Currency): string {
  return `RAZORPAY_PLAN_${planId.toUpperCase()}_${INTERVAL_ENV_SUFFIX[interval]}${CURRENCY_ENV_SUFFIX[currency]}`;
}

type OfferingKey = `${PaidPlanId}:${BillingInterval}`;

// Plan/interval combinations that aren't sold in a currency even when a
// Razorpay plan id is configured. INR: Scale 6- and 12-month charge more
// than the Razorpay account's ₹50,000 per-transaction limit
// (INDIA_MAX_TRANSACTION_PAISE), so Razorpay would decline them. Remove an
// entry only once the account is confirmed to accept that amount.
const NOT_SOLD: Record<Currency, ReadonlySet<OfferingKey>> = {
  INR: new Set<OfferingKey>(["scale:6_month", "scale:12_month"]),
  USD: new Set<OfferingKey>(),
};

export const INDIA_MAX_TRANSACTION_PAISE = 5_000_000;

// RBI's e-mandate rules require the customer to authenticate (e.g. an OTP)
// each recurring debit above ₹15,000, so renewals at or above this are not
// silent auto-debits.
export const INDIA_RECURRING_AUTHENTICATION_THRESHOLD_PAISE = 1_500_000;

export type OfferingAvailability =
  // Purchasable now.
  | "available"
  // No Razorpay plan id configured for this plan/interval/currency yet.
  | "not_configured"
  // Deliberately not sold in this currency (see NOT_SOLD).
  | "not_sold";

export interface PlanOffering {
  planId: PaidPlanId;
  interval: BillingInterval;
  currency: Currency;
  // The payment currency's smallest unit (paise/cents): exactly what the
  // Razorpay plan for this offering must charge per billing cycle.
  amount: number;
  // The customer-facing price — always USD, whatever the payment currency.
  price: DisplayPlanPrice;
  // `amount` formatted in the payment currency (e.g. "₹1,152.00"), shown as
  // "Charged as … via Razorpay". Set only when the payment currency isn't
  // the USD display currency and the offering can actually be bought.
  chargedAs: string | null;
  discountPercent: number;
  availability: OfferingAvailability;
  // Set only when availability is "available".
  razorpayPlanId: string | null;
  razorpayPlanEnvVar: string;
  requiresRecurringAuthentication: boolean;
}

export type PlanOfferingView = Omit<PlanOffering, "razorpayPlanId" | "razorpayPlanEnvVar">;

export type PlanOfferingGrid = Record<PaidPlanId, Record<BillingInterval, PlanOfferingView>>;

function amountFor(launchPriceCents: number, interval: BillingInterval, currency: Currency): number {
  return currency === "INR"
    ? calculateIntervalPriceInrPaise(launchPriceCents, interval)
    : calculateIntervalPrice(launchPriceCents, interval).totalCents;
}

export function requiresRecurringAuthentication(amount: number, currency: Currency): boolean {
  return currency === "INR" && amount > INDIA_RECURRING_AUTHENTICATION_THRESHOLD_PAISE;
}

export function getPlanOffering(planId: PaidPlanId, interval: BillingInterval, currency: Currency): PlanOffering {
  const plan = PLANS[planId];
  // Every paid plan has prices (plans.test.ts); this only narrows the type.
  if (plan.launchPriceCents === null || plan.regularPriceCents === null) {
    throw new Error(`Plan ${planId} has no price.`);
  }

  const amount = amountFor(plan.launchPriceCents, interval, currency);
  const envVar = razorpayPlanEnvVar(planId, interval, currency);
  const configuredPlanId = process.env[envVar] || null;

  let availability: OfferingAvailability;
  if (NOT_SOLD[currency].has(`${planId}:${interval}`)) availability = "not_sold";
  else if (configuredPlanId === null) availability = "not_configured";
  else availability = "available";

  return {
    planId,
    interval,
    currency,
    amount,
    price: formatPlanPrice(plan.launchPriceCents, plan.regularPriceCents, interval),
    chargedAs: currency !== "USD" && availability === "available" ? formatMoney(amount, currency) : null,
    discountPercent: calculateIntervalPrice(plan.launchPriceCents, interval).discountPercent,
    availability,
    razorpayPlanId: availability === "available" ? configuredPlanId : null,
    razorpayPlanEnvVar: envVar,
    requiresRecurringAuthentication: requiresRecurringAuthentication(amount, currency),
  };
}

// Listed field by field so a plan id or env var name never reaches the client.
export function toPlanOfferingView(offering: PlanOffering): PlanOfferingView {
  return {
    planId: offering.planId,
    interval: offering.interval,
    currency: offering.currency,
    amount: offering.amount,
    price: offering.price,
    chargedAs: offering.chargedAs,
    discountPercent: offering.discountPercent,
    availability: offering.availability,
    requiresRecurringAuthentication: offering.requiresRecurringAuthentication,
  };
}

export function getPlanOfferingGrid(currency: Currency): PlanOfferingGrid {
  return Object.fromEntries(
    PAID_PLAN_IDS.map((planId) => [
      planId,
      Object.fromEntries(
        BILLING_INTERVALS.map((interval) => [interval, toPlanOfferingView(getPlanOffering(planId, interval, currency))]),
      ),
    ]),
  ) as PlanOfferingGrid;
}
