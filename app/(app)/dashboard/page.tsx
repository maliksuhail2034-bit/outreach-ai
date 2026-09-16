import {
  AlertTriangleIcon,
  MailIcon,
  MegaphoneIcon,
  MessageCircleReplyIcon,
  SendIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { getUser, getCachedProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countEmailEventsByType,
  countLeads,
  countMailboxes,
  countSendAttemptsByStatus,
  getCampaignLeadActivitySummary,
  getSettings,
  listCampaigns,
  listSendAttempts,
  type CampaignLeadActivitySummary,
} from "@/lib/db";
import { anyFailed, firstError, optionalRead } from "@/lib/db/resilient-read";
import { getDisplayName } from "@/lib/user";
import { getGreeting } from "@/lib/greeting";
import { FadeIn } from "@/components/motion/fade-in";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { SetupChecklist, type ChecklistItem } from "@/components/dashboard/setup-checklist";
import { StatCard } from "@/components/dashboard/stat-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentCampaignsTable, type RecentCampaignRow } from "@/components/dashboard/recent-campaigns-table";
import { RecentSendingActivity } from "@/components/dashboard/recent-sending-activity";
import { DashboardTips } from "@/components/dashboard/dashboard-tips";
import { WidgetErrorBoundary } from "@/components/ui/widget-error-boundary";
import { ThrowIfFailed } from "@/components/ui/throw-if-failed";

const EMPTY_ACTIVITY_SUMMARY: CampaignLeadActivitySummary = {
  leadsCount: 0,
  nextSendAt: null,
  lastActivityAt: null,
};

const RECENT_CAMPAIGNS_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 8;

export default async function DashboardPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  // Every one of these is independent widget data, not something the page
  // itself needs to function (unlike, say, app/(app)/campaigns/[campaignId]/
  // page.tsx's core enrolled-leads read) — this is exactly the set of
  // sections WidgetErrorBoundary below already isolates at render time. Each
  // is wrapped in optionalRead so a single transient Supabase/PostgREST/
  // network failure degrades just that section instead of rejecting this
  // Promise.all and crashing the whole page (the "Something went wrong
  // loading this page" production issue this fixes). A non-transient error —
  // a real application/data bug — still propagates and fails the page, same
  // as before.
  //
  // Each is kicked off immediately (assigned, not awaited) rather than
  // awaited one at a time, plus a 10th derived promise below for the
  // per-campaign activity summaries, which only actually depends on
  // campaignsPromise. Chaining that off campaignsPromise directly — instead
  // of awaiting this whole batch first and only starting it after — means
  // the summary fan-out begins the moment campaigns resolves and runs
  // concurrently with whichever of the other 9 reads are still in flight,
  // instead of always waiting for the slowest of the 9 first.
  const profilePromise = optionalRead(() => getCachedProfile(user.id), null);
  const settingsPromise = optionalRead(() => getSettings(supabase, user.id), null);
  const leadCountPromise = optionalRead(() => countLeads(supabase, user.id), 0);
  const campaignsPromise = optionalRead(() => listCampaigns(supabase, user.id), []);
  const mailboxCountPromise = optionalRead(() => countMailboxes(supabase, user.id), 0);
  const emailsSentCountPromise = optionalRead(() => countEmailEventsByType(supabase, "sent"), 0);
  const repliedCountPromise = optionalRead(() => countEmailEventsByType(supabase, "replied"), 0);
  const failedSendsCountPromise = optionalRead(() => countSendAttemptsByStatus(supabase, "failed"), 0);
  const recentAttemptsPromise = optionalRead(() => listSendAttempts(supabase, RECENT_ACTIVITY_LIMIT), []);

  // Recent Campaigns table needs a lead count plus two extremal timestamps
  // per campaign, not every enrolled lead row — getCampaignLeadActivitySummary
  // (Performance audit's P8) derives them via three small, already-indexed
  // lookups instead of fetching every campaign_leads row per campaign here.
  // Each campaign's summary is fetched independently (optionalRead, not a
  // bare Promise.all): before this fix, one campaign's summary failing
  // transiently rejected the whole array and crashed the page, even though
  // the other campaigns' summaries had already succeeded. Bounded to
  // RECENT_CAMPAIGNS_LIMIT campaigns — never unbounded concurrency.
  const recentCampaignRowsPromise = campaignsPromise.then((campaignsResult) =>
    Promise.all(
      (campaignsResult.data ?? []).slice(0, RECENT_CAMPAIGNS_LIMIT).map(async (campaign) => {
        const summaryResult = await optionalRead(
          () => getCampaignLeadActivitySummary(supabase, campaign.id),
          EMPTY_ACTIVITY_SUMMARY,
        );
        const summary = summaryResult.data;
        const lastActivityCandidates = [campaign.updated_at, summary.lastActivityAt].filter(
          (value): value is string => value !== null,
        ).sort();

        const row: RecentCampaignRow = {
          campaign,
          leadsCount: summary.leadsCount,
          nextSendAt: summary.nextSendAt,
          lastActivity: lastActivityCandidates[lastActivityCandidates.length - 1],
        };
        return { row, failed: summaryResult.failed, error: summaryResult.error };
      }),
    ),
  );

  const [
    profileResult,
    settingsResult,
    leadCountResult,
    campaignsResult,
    mailboxCountResult,
    emailsSentCountResult,
    repliedCountResult,
    failedSendsCountResult,
    recentAttemptsResult,
    recentCampaignRowResults,
  ] = await Promise.all([
    profilePromise,
    settingsPromise,
    leadCountPromise,
    campaignsPromise,
    mailboxCountPromise,
    emailsSentCountPromise,
    repliedCountPromise,
    failedSendsCountPromise,
    recentAttemptsPromise,
    recentCampaignRowsPromise,
  ]);

  const profile = profileResult.data;
  const settings = settingsResult.data;
  const leadCount = leadCountResult.data;
  const campaigns = campaignsResult.data;
  const mailboxCount = mailboxCountResult.data;
  const emailsSentCount = emailsSentCountResult.data;
  const repliedCount = repliedCountResult.data;
  const failedSendsCount = failedSendsCountResult.data;
  const recentAttempts = recentAttemptsResult.data;

  const displayName = getDisplayName(user, profile);
  const greeting = getGreeting(profile?.timezone);
  const campaignList = campaigns ?? [];
  const campaignCount = campaignList.length;
  const activeCampaignCount = campaignList.filter((campaign) => campaign.status === "active").length;
  const hasLaunchedCampaign = campaignList.some(
    (campaign) => campaign.status === "active" || campaign.status === "completed",
  );

  const recentCampaignRows = recentCampaignRowResults.map((result) => result.row);

  const checklistItems: ChecklistItem[] = [
    { id: "profile", label: "Complete your profile", done: Boolean(profile?.full_name), href: "/settings" },
    { id: "account", label: "Configure sending preferences", done: settings !== null, href: "/settings" },
    { id: "mailbox", label: "Connect a mailbox", done: mailboxCount > 0, href: "/mailboxes" },
    { id: "leads", label: "Import your first leads", done: leadCount > 0, href: "/leads" },
    { id: "campaign", label: "Create a campaign", done: campaignCount > 0, href: "/campaigns" },
    { id: "launch", label: "Launch your first campaign", done: hasLaunchedCampaign, href: "/campaigns" },
  ];

  const stats = [
    {
      title: "Total campaigns",
      value: campaignCount,
      icon: <MegaphoneIcon className="size-4" />,
      description: "Campaigns you've created",
      emptyHint: "Create your first campaign.",
      isEmpty: campaignCount === 0,
      failed: campaignsResult.failed,
      error: campaignsResult.error,
    },
    {
      title: "Total leads",
      value: leadCount,
      icon: <UsersIcon className="size-4" />,
      description: "Total leads in your account",
      emptyHint: "Import your first lead list.",
      isEmpty: leadCount === 0,
      failed: leadCountResult.failed,
      error: leadCountResult.error,
    },
    {
      title: "Connected mailboxes",
      value: mailboxCount,
      icon: <MailIcon className="size-4" />,
      description: "Sending inboxes connected",
      emptyHint: "Connect a sending mailbox.",
      isEmpty: mailboxCount === 0,
      failed: mailboxCountResult.failed,
      error: mailboxCountResult.error,
    },
    {
      title: "Emails sent",
      value: emailsSentCount,
      icon: <SendIcon className="size-4" />,
      description: "Successful sends across all campaigns",
      emptyHint: "Will appear once a campaign starts sending.",
      isEmpty: emailsSentCount === 0,
      failed: emailsSentCountResult.failed,
      error: emailsSentCountResult.error,
    },
    {
      title: "Replies",
      value: repliedCount,
      icon: <MessageCircleReplyIcon className="size-4" />,
      description: "Replies detected across all campaigns",
      emptyHint: "Will appear once a lead replies.",
      isEmpty: repliedCount === 0,
      failed: repliedCountResult.failed,
      error: repliedCountResult.error,
    },
    {
      title: "Failed sends",
      value: failedSendsCount,
      icon: <AlertTriangleIcon className="size-4" />,
      description: "Sends that didn't go through",
      emptyHint: "No failed sends — nice.",
      isEmpty: failedSendsCount === 0,
      tone: "danger" as const,
      failed: failedSendsCountResult.failed,
      error: failedSendsCountResult.error,
    },
    {
      title: "Active campaigns",
      value: activeCampaignCount,
      icon: <ZapIcon className="size-4" />,
      description: "Campaigns currently sending",
      emptyHint: "Activate a campaign to start sending.",
      isEmpty: activeCampaignCount === 0,
      // Derived from the same campaigns fetch as "Total campaigns" above.
      failed: campaignsResult.failed,
      error: campaignsResult.error,
    },
  ];

  const checklistFailure = firstError(
    profileResult,
    settingsResult,
    mailboxCountResult,
    leadCountResult,
    campaignsResult,
  );
  const recentCampaignsFailed =
    campaignsResult.failed || anyFailed(...recentCampaignRowResults);
  const recentCampaignsError = campaignsResult.error ?? recentCampaignRowResults.find((r) => r.failed)?.error;

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardHero displayName={displayName} greeting={greeting} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FadeIn delay={0.05}>
            <WidgetErrorBoundary label="Setup checklist">
              {checklistFailure ? <ThrowIfFailed error={checklistFailure} /> : <SetupChecklist items={checklistItems} />}
            </WidgetErrorBoundary>
          </FadeIn>

          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
              {stats.map(({ failed, error, ...stat }, index) => (
                <FadeIn key={stat.title} delay={0.1 + index * 0.05}>
                  <WidgetErrorBoundary label={stat.title}>
                    {failed ? <ThrowIfFailed error={error} /> : <StatCard {...stat} />}
                  </WidgetErrorBoundary>
                </FadeIn>
              ))}
            </div>
          </div>

          <FadeIn delay={0.4}>
            <WidgetErrorBoundary label="Recent campaigns">
              {recentCampaignsFailed ? (
                <ThrowIfFailed error={recentCampaignsError} />
              ) : (
                <RecentCampaignsTable rows={recentCampaignRows} />
              )}
            </WidgetErrorBoundary>
          </FadeIn>

          <FadeIn delay={0.45} className="space-y-3">
            <h2 className="font-semibold tracking-tight">Quick actions</h2>
            <WidgetErrorBoundary label="Quick actions">
              <QuickActions />
            </WidgetErrorBoundary>
          </FadeIn>

          <FadeIn delay={0.5}>
            <WidgetErrorBoundary label="Tips">
              <DashboardTips />
            </WidgetErrorBoundary>
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="lg:col-span-1">
          <WidgetErrorBoundary label="Recent sending activity">
            {recentAttemptsResult.failed ? (
              <ThrowIfFailed error={recentAttemptsResult.error} />
            ) : (
              <RecentSendingActivity attempts={recentAttempts ?? []} />
            )}
          </WidgetErrorBoundary>
        </FadeIn>
      </div>
    </div>
  );
}
