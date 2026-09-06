import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { PAID_PLAN_IDS, PLANS, UNLIMITED, type PlanId } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

// Reads the same plan/limit constants the real billing page uses (see
// lib/billing/plans.ts) — no invented numbers. Deliberately shows no
// monetary price: actual amounts live in Stripe, not in this repo, so
// showing a number here would risk it being wrong. Update PLAN_BLURBS below
// once real pricing copy is finalized; the limits themselves stay in sync
// automatically since they're read from PLANS.
const PLAN_BLURBS: Record<PlanId, string> = {
  free: "Try the workspace with a single mailbox.",
  starter: "For a first outreach motion.",
  pro: "For teams running outreach at scale.",
  agency: "For agencies managing outreach across clients.",
};

function limitLine(label: string, value: number) {
  return value === UNLIMITED ? `Unlimited ${label}` : `${value.toLocaleString()} ${label}`;
}

const ALL_PLAN_IDS: PlanId[] = ["free", ...PAID_PLAN_IDS];

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
              Every plan includes mailbox connections, lead management, campaigns, and analytics. Limits scale
              with how much outreach you run.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ALL_PLAN_IDS.map((planId) => {
              const plan = PLANS[planId];
              return (
                <Card key={planId} className="flex flex-col">
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{PLAN_BLURBS[planId]}</p>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {[
                        limitLine("mailboxes", plan.limits.mailboxes),
                        limitLine("leads", plan.limits.leads),
                        limitLine("campaigns", plan.limits.campaigns),
                        limitLine("daily sends", plan.limits.dailySends),
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
          <p className="mt-6 text-center text-sm text-muted-foreground">Pricing is confirmed during checkout.</p>
        </FadeIn>
      </Container>
    </section>
  );
}
