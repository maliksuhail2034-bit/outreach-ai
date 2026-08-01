import { CheckIcon } from "lucide-react";

import { PAID_PLAN_IDS, PLANS, UNLIMITED, type PlanId } from "@/lib/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckoutButton } from "./checkout-button";

function limitLine(label: string, value: number) {
  return value === UNLIMITED ? `Unlimited ${label}` : `${value.toLocaleString()} ${label}`;
}

// Yearly billing is modeled in lib/billing/plans.ts (interval is a real
// parameter throughout checkout/webhook resolution) but deliberately not
// offered here yet — this only ever checks out at "monthly", per the task's
// "prepare even if not exposed yet".
const INTERVAL = "monthly" as const;

export function PlanList({ currentPlanId }: { currentPlanId: PlanId }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className={currentPlanId === "free" ? "border-primary/40" : undefined}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Free</CardTitle>
            {currentPlanId === "free" && <Badge>Current plan</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              limitLine("mailbox", PLANS.free.limits.mailboxes),
              limitLine("leads", PLANS.free.limits.leads),
              limitLine("campaign", PLANS.free.limits.campaigns),
              limitLine("daily sends", PLANS.free.limits.dailySends),
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="w-full" disabled>
            {currentPlanId === "free" ? "Current plan" : "Included"}
          </Button>
        </CardFooter>
      </Card>

      {PAID_PLAN_IDS.map((planId) => {
        const plan = PLANS[planId];
        const isCurrent = currentPlanId === planId;
        const priceId = plan.monthlyPriceId;

        return (
          <Card key={planId} className={isCurrent ? "border-primary/40" : undefined}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{plan.name}</CardTitle>
                {isCurrent && <Badge>Current plan</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {[
                  limitLine("mailboxes", plan.limits.mailboxes),
                  limitLine("leads", plan.limits.leads),
                  limitLine("campaigns", plan.limits.campaigns),
                  limitLine("daily sends", plan.limits.dailySends),
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
                <CheckoutButton planId={planId} interval={INTERVAL} disabled={!priceId}>
                  {priceId ? "Upgrade" : "Coming soon"}
                </CheckoutButton>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
