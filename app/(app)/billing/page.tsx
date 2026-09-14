import { CalendarClockIcon, MailIcon, MegaphoneIcon, SendIcon, UsersIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { countCampaigns, countLeads, countMailboxes, getUserOrganization, listCampaigns } from "@/lib/db";
import { getPlanForOrganization } from "@/lib/billing/resolve-plan";
import { getActiveSubscriptionView } from "@/lib/billing/subscription-view";
import { BILLING_INTERVALS, PAID_PLAN_IDS, UNLIMITED, getRazorpayPlanId } from "@/lib/billing/plans";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { ManageSubscriptionButton } from "@/components/billing/manage-subscription-button";
import { PlanList } from "@/components/billing/plan-list";

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });

// Keyed on the canonical, provider-agnostic vocabulary from
// lib/billing/subscription-view.ts — the only vocabulary this page ever
// renders, whether the underlying subscription is legacy Stripe or
// subscriptions_v2 (Razorpay). Note the canonical spelling is "cancelled",
// not legacy's "canceled" — the display copy itself is unchanged.
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  trialing: "Trialing",
  past_due: "Payment past due",
  suspended: "Suspended",
  cancelled: "Canceled",
  expired: "Expired",
  completed: "Completed",
};

function usageValue(count: number, limit: number) {
  return limit === UNLIMITED ? `${count.toLocaleString()}` : `${count.toLocaleString()} / ${limit.toLocaleString()}`;
}

export default async function BillingPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const [plan, subscriptionView, mailboxCount, campaignCount, leadCount, campaigns] = await Promise.all([
    getPlanForOrganization(supabase, organization.id),
    getActiveSubscriptionView(supabase, organization.id),
    countMailboxes(supabase, user.id),
    countCampaigns(supabase, user.id),
    countLeads(supabase, user.id),
    listCampaigns(supabase, user.id),
  ]);

  const dailySendTotal = (campaigns ?? []).reduce((sum, campaign) => sum + campaign.daily_limit, 0);
  const isPaidPlan = plan.id !== "free";

  // RAZORPAY_PLAN_<PLAN>_<INTERVAL> is server-only (not NEXT_PUBLIC_), so it
  // must be resolved here (a Server Component) and passed down as data —
  // PlanList is a Client Component and calling getRazorpayPlanId() from
  // there would silently always return null in the browser bundle.
  const razorpayPlanIds = Object.fromEntries(
    PAID_PLAN_IDS.map((planId) => [
      planId,
      Object.fromEntries(BILLING_INTERVALS.map((interval) => [interval, getRazorpayPlanId(planId, interval)])),
    ]),
  ) as Record<(typeof PAID_PLAN_IDS)[number], Record<(typeof BILLING_INTERVALS)[number], string | null>>;

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Billing</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Manage your plan, usage, and subscription.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div>
                <CardTitle>Current plan</CardTitle>
                <CardDescription>{plan.name}</CardDescription>
              </div>
              {subscriptionView.normalizedStatus && (
                <Badge variant="secondary">{STATUS_LABEL[subscriptionView.normalizedStatus] ?? subscriptionView.normalizedStatus}</Badge>
              )}
            </div>
            {isPaidPlan && <ManageSubscriptionButton />}
          </CardHeader>
          {subscriptionView.currentPeriodEnd && (
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClockIcon className="size-4" />
              {subscriptionView.cancelAtPeriodEnd
                ? `Cancels on ${dateFormatter.format(new Date(subscriptionView.currentPeriodEnd))}`
                : `Renews on ${dateFormatter.format(new Date(subscriptionView.currentPeriodEnd))}`}
            </CardContent>
          )}
        </Card>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="@container">
          <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-4">
            <StatCard
              title="Mailboxes"
              value={usageValue(mailboxCount, plan.limits.mailboxes)}
              icon={<MailIcon className="size-4" />}
            />
            <StatCard
              title="Campaigns"
              value={usageValue(campaignCount, plan.limits.campaigns)}
              icon={<MegaphoneIcon className="size-4" />}
            />
            <StatCard
              title="Leads"
              value={usageValue(leadCount, plan.limits.leads)}
              icon={<UsersIcon className="size-4" />}
            />
            <StatCard
              title="Daily sends configured"
              value={usageValue(dailySendTotal, plan.limits.dailySends)}
              icon={<SendIcon className="size-4" />}
              description="Summed across all your campaigns"
            />
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.15} className="space-y-3">
        <h2 className="font-semibold tracking-tight">Plans</h2>
        <PlanList currentPlanId={plan.id} razorpayPlanIds={razorpayPlanIds} />
      </FadeIn>
    </div>
  );
}
