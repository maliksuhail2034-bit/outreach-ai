import {
  AlertTriangleIcon,
  MailIcon,
  MegaphoneIcon,
  MessageCircleReplyIcon,
  SendIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countEmailEventsByType,
  countLeads,
  countMailboxes,
  countSendAttemptsByStatus,
  getCampaignLeadActivitySummary,
  getProfile,
  getSettings,
  listCampaigns,
  listSendAttempts,
} from "@/lib/db";
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

const RECENT_CAMPAIGNS_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 8;

export default async function DashboardPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const [
    profile,
    settings,
    leadCount,
    campaigns,
    mailboxCount,
    emailsSentCount,
    repliedCount,
    failedSendsCount,
    recentAttempts,
  ] = await Promise.all([
    getProfile(supabase, user.id),
    getSettings(supabase, user.id),
    countLeads(supabase, user.id),
    listCampaigns(supabase, user.id),
    countMailboxes(supabase, user.id),
    countEmailEventsByType(supabase, "sent"),
    countEmailEventsByType(supabase, "replied"),
    countSendAttemptsByStatus(supabase, "failed"),
    listSendAttempts(supabase, RECENT_ACTIVITY_LIMIT),
  ]);

  const displayName = getDisplayName(user, profile);
  const greeting = getGreeting(profile?.timezone);
  const campaignList = campaigns ?? [];
  const campaignCount = campaignList.length;
  const activeCampaignCount = campaignList.filter((campaign) => campaign.status === "active").length;
  const hasLaunchedCampaign = campaignList.some(
    (campaign) => campaign.status === "active" || campaign.status === "completed",
  );

  // Recent Campaigns table needs a lead count plus two extremal timestamps
  // per campaign, not every enrolled lead row — getCampaignLeadActivitySummary
  // (Performance audit's P8) derives them via three small, already-indexed
  // lookups instead of fetching every campaign_leads row per campaign here.
  const recentCampaignRows: RecentCampaignRow[] = await Promise.all(
    campaignList.slice(0, RECENT_CAMPAIGNS_LIMIT).map(async (campaign) => {
      const summary = await getCampaignLeadActivitySummary(supabase, campaign.id);
      const lastActivityCandidates = [campaign.updated_at, summary.lastActivityAt].filter(
        (value): value is string => value !== null,
      ).sort();

      return {
        campaign,
        leadsCount: summary.leadsCount,
        nextSendAt: summary.nextSendAt,
        lastActivity: lastActivityCandidates[lastActivityCandidates.length - 1],
      };
    }),
  );

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
    },
    {
      title: "Total leads",
      value: leadCount,
      icon: <UsersIcon className="size-4" />,
      description: "Total leads in your account",
      emptyHint: "Import your first lead list.",
      isEmpty: leadCount === 0,
    },
    {
      title: "Connected mailboxes",
      value: mailboxCount,
      icon: <MailIcon className="size-4" />,
      description: "Sending inboxes connected",
      emptyHint: "Connect a sending mailbox.",
      isEmpty: mailboxCount === 0,
    },
    {
      title: "Emails sent",
      value: emailsSentCount,
      icon: <SendIcon className="size-4" />,
      description: "Successful sends across all campaigns",
      emptyHint: "Will appear once a campaign starts sending.",
      isEmpty: emailsSentCount === 0,
    },
    {
      title: "Replies",
      value: repliedCount,
      icon: <MessageCircleReplyIcon className="size-4" />,
      description: "Replies detected across all campaigns",
      emptyHint: "Will appear once a lead replies.",
      isEmpty: repliedCount === 0,
    },
    {
      title: "Failed sends",
      value: failedSendsCount,
      icon: <AlertTriangleIcon className="size-4" />,
      description: "Sends that didn't go through",
      emptyHint: "No failed sends — nice.",
      isEmpty: failedSendsCount === 0,
    },
    {
      title: "Active campaigns",
      value: activeCampaignCount,
      icon: <ZapIcon className="size-4" />,
      description: "Campaigns currently sending",
      emptyHint: "Activate a campaign to start sending.",
      isEmpty: activeCampaignCount === 0,
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardHero displayName={displayName} greeting={greeting} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FadeIn delay={0.05}>
            <SetupChecklist items={checklistItems} />
          </FadeIn>

          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
              {stats.map((stat, index) => (
                <FadeIn key={stat.title} delay={0.1 + index * 0.05}>
                  <StatCard {...stat} />
                </FadeIn>
              ))}
            </div>
          </div>

          <FadeIn delay={0.4}>
            <RecentCampaignsTable rows={recentCampaignRows} />
          </FadeIn>

          <FadeIn delay={0.45} className="space-y-3">
            <h2 className="font-semibold tracking-tight">Quick actions</h2>
            <QuickActions />
          </FadeIn>

          <FadeIn delay={0.5}>
            <DashboardTips />
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="lg:col-span-1">
          <RecentSendingActivity attempts={recentAttempts ?? []} />
        </FadeIn>
      </div>
    </div>
  );
}
