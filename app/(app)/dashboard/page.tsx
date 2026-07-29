import { MailIcon, MegaphoneIcon, TrendingUpIcon, UsersIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { countLeads, countMailboxes, getProfile, getSettings, listCampaigns } from "@/lib/db";
import { getDisplayName } from "@/lib/user";
import { getGreeting } from "@/lib/greeting";
import { FadeIn } from "@/components/motion/fade-in";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { SetupChecklist, type ChecklistItem } from "@/components/dashboard/setup-checklist";
import { StatCard } from "@/components/dashboard/stat-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { DashboardTips } from "@/components/dashboard/dashboard-tips";

export default async function DashboardPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const [profile, settings, leadCount, campaigns, mailboxCount] = await Promise.all([
    getProfile(supabase, user.id),
    getSettings(supabase, user.id),
    countLeads(supabase, user.id),
    listCampaigns(supabase, user.id),
    countMailboxes(supabase, user.id),
  ]);

  const displayName = getDisplayName(user, profile);
  const greeting = getGreeting(profile?.timezone);
  const campaignList = campaigns ?? [];
  const campaignCount = campaignList.length;
  const hasLaunchedCampaign = campaignList.some((campaign) => campaign.status === "active" || campaign.status === "completed");

  const checklistItems: ChecklistItem[] = [
    { id: "profile", label: "Complete your profile", done: Boolean(profile?.full_name), href: "/settings" },
    { id: "account", label: "Configure sending preferences", done: settings !== null, href: "/settings" },
    { id: "mailbox", label: "Connect a mailbox", done: mailboxCount > 0, href: "/mailboxes" },
    { id: "leads", label: "Import your first leads", done: leadCount > 0, href: "/leads" },
    {
      id: "campaign",
      label: "Create a campaign",
      done: campaignCount > 0,
      toastMessage: "Campaign creation is the next feature we're building.",
    },
    {
      id: "launch",
      label: "Launch your first campaign",
      done: hasLaunchedCampaign,
      toastMessage: "Launching will be available after campaigns are implemented.",
    },
  ];

  const stats = [
    {
      title: "Leads",
      value: leadCount,
      icon: <UsersIcon className="size-4" />,
      description: "Total leads in your account",
      emptyHint: "Import your first lead list.",
      isEmpty: leadCount === 0,
    },
    {
      title: "Campaigns",
      value: campaignCount,
      icon: <MegaphoneIcon className="size-4" />,
      description: "Campaigns you've created",
      emptyHint: "Create your first campaign.",
      isEmpty: campaignCount === 0,
    },
    {
      title: "Mailboxes",
      value: mailboxCount,
      icon: <MailIcon className="size-4" />,
      description: "Connected sending inboxes",
      emptyHint: "Connect a sending mailbox.",
      isEmpty: mailboxCount === 0,
    },
    {
      title: "Reply rate",
      value: "—",
      icon: <TrendingUpIcon className="size-4" />,
      emptyHint: "Will appear after your first campaign.",
      isEmpty: true,
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
            <div className="grid gap-4 @sm:grid-cols-2 @xl:grid-cols-4">
              {stats.map((stat, index) => (
                <FadeIn key={stat.title} delay={0.1 + index * 0.05}>
                  <StatCard {...stat} />
                </FadeIn>
              ))}
            </div>
          </div>

          <FadeIn delay={0.3} className="space-y-3">
            <h2 className="font-semibold tracking-tight">Quick actions</h2>
            <QuickActions />
          </FadeIn>

          <FadeIn delay={0.35}>
            <DashboardTips />
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="lg:col-span-1">
          <RecentActivity />
        </FadeIn>
      </div>
    </div>
  );
}
