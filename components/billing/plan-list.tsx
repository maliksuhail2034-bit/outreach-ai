"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { BILLING_INTERVALS, PAID_PLAN_IDS, PLANS, UNLIMITED, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { calculateIntervalPrice, formatCents } from "@/lib/billing/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckoutButton } from "./checkout-button";

function limitLine(label: string, value: number) {
  return value === UNLIMITED ? `Unlimited ${label}` : `${value.toLocaleString()} ${label}`;
}

const INTERVAL_LABEL: Record<BillingInterval, string> = {
  "1_month": "1 month",
  "3_month": "3 months",
  "6_month": "6 months",
  "12_month": "12 months",
};

export function PlanList({ currentPlanId }: { currentPlanId: PlanId }) {
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
              <CardFooter>
                {isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : (
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
