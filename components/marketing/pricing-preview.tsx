import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { PAID_PLAN_IDS, PLANS, UNLIMITED, type PaidPlanId } from "@/lib/billing/plans";
import { calculateIntervalPrice, formatCents } from "@/lib/billing/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

// Reads the same plan/limit/price constants the real billing page uses (see
// lib/billing/plans.ts) — no invented numbers. There is no public Free
// tier: every plan shown here is a real, purchasable plan (Checkout is
// disabled with "Coming soon" per-plan until Stripe is actually configured
// — see lib/billing/plans.ts's priceIds). Update PLAN_BLURBS below if the
// positioning copy changes; the limits/prices themselves stay in sync
// automatically since they're read from PLANS.
const PLAN_BLURBS: Record<PaidPlanId, string> = {
  starter: "For a first outreach motion.",
  growth: "For a growing outbound team.",
  pro: "For teams running outreach at scale.",
  scale: "For high-volume senders across many mailboxes.",
};

function limitLine(label: string, value: number) {
  return value === UNLIMITED ? `Unlimited ${label}` : `${value.toLocaleString()} ${label}`;
}

// Monthly (1_month, no discount) is what a landing page should lead with —
// the billing duration selector with its 3/6/12-month discounts lives on
// the real billing page (components/billing/plan-list.tsx), once someone
// has actually signed up.
const PREVIEW_INTERVAL = "1_month" as const;

export function PricingPreview() {
  return (
    <section id="pricing" className="scroll-mt-16 border-b border-border bg-sidebar/40 py-20 sm:py-28">
      <Container>
        <FadeIn>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Plans that grow with your outreach
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every plan includes mailbox warmup, BYOK AI features, campaigns, sequences, analytics, and
              deliverability monitoring. Limits scale with how much outreach you run.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PAID_PLAN_IDS.map((planId) => {
              const plan = PLANS[planId];
              const price = plan.launchPriceCents !== null ? calculateIntervalPrice(plan.launchPriceCents, PREVIEW_INTERVAL) : null;

              return (
                <Card key={planId} className="flex flex-col">
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{PLAN_BLURBS[planId]}</p>
                    {plan.regularPriceCents !== null && plan.launchPriceCents !== null && price && (
                      <div className="mt-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-semibold tracking-tight">{formatCents(price.totalCents)}</span>
                          <span className="text-sm text-muted-foreground">/month</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="line-through">{formatCents(plan.regularPriceCents)}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            Launch price
                          </Badge>
                        </div>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1">
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {[
                        limitLine("mailboxes", plan.limits.mailboxes),
                        limitLine("leads", plan.limits.leads),
                        limitLine("emails / month", plan.limits.emailsPerMonth),
                        limitLine("campaigns", plan.limits.campaigns),
                      ].map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button asChild className="w-full" variant={planId === "pro" ? "default" : "outline"}>
                      <Link href="/signup">Get started</Link>
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Save up to 20% on 3/6/12-month billing — pick a duration during checkout.
          </p>
        </FadeIn>
      </Container>
    </section>
  );
}
