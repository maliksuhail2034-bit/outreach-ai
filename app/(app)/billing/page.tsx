import { CalendarClockIcon, MailIcon, MegaphoneIcon, SendIcon, UsersIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { countCampaigns, countLeads, countMailboxes, getUserOrganization, listCampaigns } from "@/lib/db";
import { getPlanForOrganization, isInternalUnlimitedOrganization } from "@/lib/billing/resolve-plan";
import { getActiveSubscriptionView } from "@/lib/billing/subscription-view";
import { NON_TERMINAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/razorpay-status";
import { getSubscriptionV2 } from "@/lib/db/billing-v2";
import { currencyForRegion, getBillingRegion } from "@/lib/billing/region";
import { UNLIMITED } from "@/lib/billing/plans";
import { getPlanOfferingGrid } from "@/lib/billing/offerings";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { ManageSubscriptionButton } from "@/components/billing/manage-subscription-button";
import { ManageRazorpaySubscriptionButton } from "@/components/billing/manage-razorpay-subscription-button";
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

  const [billingRegion, plan, subscriptionView, subscriptionV2, mailboxCount, campaignCount, leadCount, campaigns] = await Promise.all([
    getBillingRegion(),
    getPlanForOrganization(supabase, organization.id),
    getActiveSubscriptionView(supabase, organization.id),
    getSubscriptionV2(supabase, organization.id),
    countMailboxes(supabase, user.id),
    countCampaigns(supabase, user.id),
    countLeads(supabase, user.id),
    listCampaigns(supabase, user.id),
  ]);

  const dailySendTotal = (campaigns ?? []).reduce((sum, campaign) => sum + campaign.daily_limit, 0);
  const isPaidPlan = plan.id !== "free";
  const internalUnlimited = isInternalUnlimitedOrganization(organization.id);
  // Same row and same status set createRazorpaySubscriptionAction's
  // duplicate-checkout guard checks, so the page never offers a checkout
  // that action would reject.
  const planChangeBlocked =
    subscriptionV2?.provider === "razorpay" && NON_TERMINAL_SUBSCRIPTION_STATUSES.has(subscriptionV2.normalized_status);

  // Resolved by the same region -> currency -> offering chain the Razorpay
  // checkout action re-runs server-side, so the page never offers a checkout
  // that action would reject. Razorpay plan ids are server-only env vars and
  // stay here: PlanList (a Client Component) only gets each offering's
  // price and availability.
  const billingCurrency = currencyForRegion(billingRegion);
  const offerings = getPlanOfferingGrid(billingCurrency);
  // The internal workspace's plan carries the "scale" id only for type
  // reasons — it must not mark the Scale card as its current plan.
  const currentPlanId = internalUnlimited || plan.id === "free" ? null : plan.id;

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
                <Badge variant="secondary">
                  {subscriptionView.periodLapsed
                    ? "Renewal not confirmed"
                    : (STATUS_LABEL[subscriptionView.normalizedStatus] ?? subscriptionView.normalizedStatus)}
                </Badge>
              )}
            </div>
            {isPaidPlan && subscriptionView.provider === "stripe" && <ManageSubscriptionButton />}
            {/* Keyed on the live subscriptions_v2 row, not isPaidPlan: a
                subscription whose period lapsed unconfirmed grants no plan
                but must still be cancellable (cancelRazorpaySubscriptionAction
                accepts exactly these statuses). */}
            {planChangeBlocked && <ManageRazorpaySubscriptionButton />}
            {/* provider === "paypal" (or null, which isPaidPlan already rules
                out) renders no management action — PayPal has no
                implementation in this codebase yet, and a subscriber on a
                provider this app can't actually act on must never be shown
                an action that looks like it would work. */}
          </CardHeader>
          {subscriptionView.currentPeriodEnd && (
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClockIcon className="size-4" />
              {subscriptionView.periodLapsed
                ? `Billing period ended on ${dateFormatter.format(new Date(subscriptionView.currentPeriodEnd))} — paid features resume once the renewal is confirmed`
                : subscriptionView.cancelAtPeriodEnd
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
        <PlanList
          currentPlanId={currentPlanId}
          offerings={offerings}
          planChangeBlocked={planChangeBlocked}
          internalUnlimited={internalUnlimited}
        />
      </FadeIn>
    </div>
  );
}
