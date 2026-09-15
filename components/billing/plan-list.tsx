"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";

import {
  BILLING_INTERVALS,
  PAID_PLAN_IDS,
  PLANS,
  UNLIMITED,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import { calculateIntervalPrice, calculateIntervalPriceInrPaise, formatCents } from "@/lib/billing/pricing";
import { formatMoney } from "@/lib/billing/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckoutButton } from "./checkout-button";
import { RazorpayCheckoutButton } from "./razorpay-checkout-button";

function limitLine(label: string, value: number) {
  return value === UNLIMITED ? `Unlimited ${label}` : `${value.toLocaleString()} ${label}`;
}

const INTERVAL_LABEL: Record<BillingInterval, string> = {
  "1_month": "1 month",
  "3_month": "3 months",
  "6_month": "6 months",
  "12_month": "12 months",
};

export function PlanList({
  currentPlanId,
  razorpayPlanIds,
}: {
  currentPlanId: PlanId;
  // RAZORPAY_PLAN_<PLAN>_<INTERVAL> is a server-only env var — resolved in
  // the Server Component (app/(app)/billing/page.tsx) and passed down as
  // plain data, since this component is a Client Component and reading it
  // here directly would always see `undefined` in the browser bundle.
  razorpayPlanIds: Record<PaidPlanId, Record<BillingInterval, string | null>>;
}) {
  const [interval, setInterval] = useState<BillingInterval>("1_month");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Billing duration">
        {BILLING_INTERVALS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={interval === option ? "default" : "outline"}
            onClick={() => setInterval(option)}
            aria-pressed={interval === option}
          >
            {INTERVAL_LABEL[option]}
            {discountPercentForInterval(option) > 0 && (
              <span className="ml-1 text-xs opacity-80">-{discountPercentForInterval(option)}%</span>
            )}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PAID_PLAN_IDS.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = currentPlanId === planId;
          const priceId = plan.priceIds[interval];
          const razorpayPlanId = razorpayPlanIds[planId][interval];
          const price = plan.launchPriceCents !== null ? calculateIntervalPrice(plan.launchPriceCents, interval) : null;

          return (
            <Card key={planId} className={isCurrent ? "border-primary/40" : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {isCurrent && <Badge>Current plan</Badge>}
                </div>
                {plan.regularPriceCents !== null && plan.launchPriceCents !== null && price && (
                  <div className="mt-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tracking-tight">{formatCents(price.totalCents)}</span>
                      <span className="text-sm text-muted-foreground">/ {INTERVAL_LABEL[interval]}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="line-through">{formatCents(plan.regularPriceCents * price.months)}</span>
                      <span>launch price</span>
                      {price.discountPercent > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          Save {price.discountPercent}%
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {[
                    limitLine("mailboxes", plan.limits.mailboxes),
                    limitLine("leads", plan.limits.leads),
                    limitLine("emails / month", plan.limits.emailsPerMonth),
                    limitLine("campaigns", plan.limits.campaigns),
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                      {line}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="flex flex-col gap-2">
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : razorpayPlanId ? (
                  // Razorpay is the active payment provider (Stripe was
                  // dropped — priceId below is null for every plan/interval
                  // until Stripe is reconfigured, if ever). A configured
                  // Razorpay plan id means this plan/interval is genuinely
                  // purchasable right now, so it gets the real, primary
                  // action instead of sitting under a misleading "Coming
                  // soon" Stripe button. No test/live wording here by
                  // design — NEXT_PUBLIC_RAZORPAY_KEY_ID's rzp_test_/
                  // rzp_live_ prefix determines what actually happens when
                  // this button is pressed; the label doesn't try to track
                  // that env-configured mode, so it can never say "test
                  // mode" while a live key is quietly charging someone.
                  <>
                    {/* The site's canonical price stays USD everywhere else
                        (see calculateIntervalPrice above) — Razorpay's
                        Indian payment rails (UPI/Indian cards/netbanking)
                        cannot charge a USD amount at all, so an Indian
                        customer must see the real INR amount before paying.
                        calculateIntervalPriceInrPaise() derives this from
                        the SAME totalCents this card's USD price uses, so
                        it can never disagree with what a Razorpay INR Plan
                        for this plan/interval is configured to charge. */}
                    {plan.launchPriceCents !== null && (
                      <p className="text-center text-xs text-muted-foreground">
                        Charged as{" "}
                        {formatMoney(calculateIntervalPriceInrPaise(plan.launchPriceCents, interval), "INR")} via
                        Razorpay (UPI, cards, netbanking)
                      </p>
                    )}
                    <RazorpayCheckoutButton planId={planId} interval={interval}>
                      Upgrade
                    </RazorpayCheckoutButton>
                  </>
                ) : (
                  // Neither provider has a plan id configured for this
                  // plan/interval — nothing to sell yet, so "Coming soon" is
                  // accurate rather than disabled-with-no-explanation. Stays
                  // wired to Stripe so it starts working again unmodified if
                  // STRIPE_PRICE_<PLAN>_<INTERVAL> is ever set.
                  <CheckoutButton planId={planId} interval={interval} disabled={!priceId}>
                    {priceId ? "Upgrade" : "Coming soon"}
                  </CheckoutButton>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Local copy of the badge's discount percent (not the full breakdown the
// price display needs) so the duration toggle above can label itself
// without depending on any one plan's launchPriceCents — the discount
// fraction is the same across every plan.
function discountPercentForInterval(interval: BillingInterval): number {
  return calculateIntervalPrice(100, interval).discountPercent;
}
