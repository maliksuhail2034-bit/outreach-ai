import {
  AlertTriangleIcon,
  MailCheckIcon,
  MailWarningIcon,
  SendIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countEmailEventsByType,
  countSendAttemptsByStatus,
  listCampaignLeads,
  listCampaigns,
  listEmailEvents,
  listSendAttempts,
  listSendAttemptsForCampaignLeads,
} from "@/lib/db";
import { bucketByDay } from "@/lib/analytics/time-buckets";
import { classifyErrorCategory, type ErrorCategory } from "@/lib/analytics/error-category";
import { FadeIn } from "@/components/motion/fade-in";
import { StatCard } from "@/components/dashboard/stat-card";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { CampaignPerformanceTable, type CampaignPerformanceRow } from "@/components/analytics/campaign-performance-table";
import { FailureAnalysis } from "@/components/analytics/failure-analysis";
import { ActivityTimeline, type TimelineEntry } from "@/components/analytics/activity-timeline";

const CHART_WINDOW_DAYS = 14;
const ANALYTICS_ROW_LIMIT = 500;
const TIMELINE_LIMIT = 20;

const EMAIL_EVENT_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  failed: "Failed",
};

const EMAIL_EVENT_VARIANT: Record<string, TimelineEntry["variant"]> = {
  sent: "default",
  delivered: "default",
  bounced: "destructive",
  failed: "destructive",
  unsubscribed: "secondary",
};

export default async function AnalyticsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  const [campaigns, totalAttempts, sentCount, failedCount, bouncedCount, deliveredCount, sendAttempts, emailEvents] =
    await Promise.all([
      listCampaigns(supabase, user.id),
      countSendAttemptsByStatus(supabase),
      countSendAttemptsByStatus(supabase, "sent"),
      countSendAttemptsByStatus(supabase, "failed"),
      countEmailEventsByType(supabase, "bounced"),
      countEmailEventsByType(supabase, "delivered"),
      listSendAttempts(supabase, ANALYTICS_ROW_LIMIT),
      listEmailEvents(supabase, undefined, { limit: ANALYTICS_ROW_LIMIT }),
    ]);

  const campaignList = campaigns ?? [];
  const attempts = sendAttempts ?? [];
  const events = emailEvents ?? [];

  const successRate = totalAttempts > 0 ? Math.round((sentCount / totalAttempts) * 100) : null;
  const failureRate = totalAttempts > 0 ? Math.round((failedCount / totalAttempts) * 100) : null;

  // Campaign performance: send_attempts has no campaign_id directly (only
  // campaign_lead_id), so each campaign's lead ids (from the existing
  // listCampaignLeads) are used to fetch its attempts via the new
  // listSendAttemptsForCampaignLeads helper.
  const performanceRows: CampaignPerformanceRow[] = await Promise.all(
    campaignList.map(async (campaign) => {
      const leadRows = (await listCampaignLeads(supabase, campaign.id)) ?? [];
      const leadIds = leadRows.map((row) => row.id);
      const campaignAttempts = (await listSendAttemptsForCampaignLeads(supabase, leadIds)) ?? [];
      const failures = campaignAttempts.filter((row) => row.status === "failed").length;

      const activityTimestamps = [
        campaign.updated_at,
        ...leadRows.map((row) => row.updated_at),
        ...campaignAttempts.map((row) => row.resolved_at ?? row.claimed_at),
      ].sort();

      return {
        campaign,
        leadsCount: leadRows.length,
        attempts: campaignAttempts.length,
        failures,
        lastActivity: activityTimestamps[activityTimestamps.length - 1] ?? null,
      };
    }),
  );

  // Charts: all derived from the same send_attempts fetch above rather than
  // separate queries per chart.
  const dailyVolume = bucketByDay(
    attempts.filter((attempt) => attempt.status === "sent").map((attempt) => attempt.resolved_at ?? attempt.claimed_at),
    CHART_WINDOW_DAYS,
  );
  const dailyFailures = bucketByDay(
    attempts.filter((attempt) => attempt.status === "failed").map((attempt) => attempt.resolved_at ?? attempt.claimed_at),
    CHART_WINDOW_DAYS,
  );
  const dailyActivity = bucketByDay(
    attempts.map((attempt) => attempt.claimed_at),
    CHART_WINDOW_DAYS,
  );

  // Failure analysis: classifies each failed attempt's already-stored
  // last_error text (see lib/analytics/error-category.ts) — display-only,
  // doesn't change how the provider/worker classify errors.
  const failureCounts: Record<ErrorCategory, number> = {
    dns: 0,
    authentication: 0,
    tls: 0,
    timeout: 0,
    unknown: 0,
  };
  for (const attempt of attempts) {
    if (attempt.status !== "failed") continue;
    failureCounts[classifyErrorCategory(attempt.last_error)] += 1;
  }

  // Activity timeline: email_events and send_attempts merged by timestamp.
  const emailEventEntries: TimelineEntry[] = events.map((event) => ({
    id: event.id,
    source: "email_event",
    label: EMAIL_EVENT_LABEL[event.event_type] ?? event.event_type,
    variant: EMAIL_EVENT_VARIANT[event.event_type] ?? "outline",
    detail: null,
    timestamp: event.created_at,
  }));
  const sendAttemptEntries: TimelineEntry[] = attempts.map((attempt) => ({
    id: attempt.id,
    source: "send_attempt",
    label: attempt.status === "sent" ? "Sent" : attempt.status === "failed" ? "Failed" : "Pending",
    variant: attempt.status === "sent" ? "default" : attempt.status === "failed" ? "destructive" : "secondary",
    detail: attempt.status === "failed" ? attempt.last_error : null,
    timestamp: attempt.resolved_at ?? attempt.claimed_at,
  }));
  const timeline = [...emailEventEntries, ...sendAttemptEntries]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, TIMELINE_LIMIT);

  const overviewStats = [
    {
      title: "Total emails attempted",
      value: totalAttempts,
      icon: <SendIcon className="size-4" />,
      description: "Every send attempt across all campaigns",
      emptyHint: "Will appear once a campaign starts sending.",
      isEmpty: totalAttempts === 0,
    },
    {
      title: "Delivered",
      value: deliveredCount,
      icon: <MailCheckIcon className="size-4" />,
      description: "Delivery confirmations received",
      emptyHint: "Delivery confirmations aren't tracked yet.",
      isEmpty: deliveredCount === 0,
    },
    {
      title: "Failed",
      value: failedCount,
      icon: <AlertTriangleIcon className="size-4" />,
      description: "Attempts that didn't go through",
      emptyHint: "No failed sends — nice.",
      isEmpty: failedCount === 0,
    },
    {
      title: "Bounce count",
      value: bouncedCount,
      icon: <MailWarningIcon className="size-4" />,
      description: "Hard bounces recorded",
      emptyHint: "No bounces recorded.",
      isEmpty: bouncedCount === 0,
    },
    {
      title: "Success rate",
      value: successRate === null ? "—" : `${successRate}%`,
      icon: <TrendingUpIcon className="size-4" />,
      description: "Sent ÷ total attempts",
      emptyHint: "Will appear once a campaign starts sending.",
      isEmpty: totalAttempts === 0,
    },
    {
      title: "Failure rate",
      value: failureRate === null ? "—" : `${failureRate}%`,
      icon: <TrendingDownIcon className="size-4" />,
      description: "Failed ÷ total attempts",
      emptyHint: "Will appear once a campaign starts sending.",
      isEmpty: totalAttempts === 0,
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Sending performance across every campaign, mailbox, and lead.
          </p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          {overviewStats.map((stat, index) => (
            <FadeIn key={stat.title} delay={0.05 + index * 0.05}>
              <StatCard {...stat} />
            </FadeIn>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <FadeIn delay={0.35}>
          <DailyBarChart
            title="Sending volume by day"
            description={`Successful sends over the last ${CHART_WINDOW_DAYS} days.`}
            data={dailyVolume}
          />
        </FadeIn>
        <FadeIn delay={0.4}>
          <DailyBarChart
            title="Failures by day"
            description={`Failed attempts over the last ${CHART_WINDOW_DAYS} days.`}
            data={dailyFailures}
            barClassName="bg-destructive"
          />
        </FadeIn>
        <FadeIn delay={0.45}>
          <DailyBarChart
            title="Campaign activity over time"
            description={`Total send attempts (sent + failed) over the last ${CHART_WINDOW_DAYS} days.`}
            data={dailyActivity}
            barClassName="bg-secondary-foreground/70"
          />
        </FadeIn>
      </div>

      <FadeIn delay={0.5}>
        <CampaignPerformanceTable rows={performanceRows} />
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.55}>
          <FailureAnalysis counts={failureCounts} />
        </FadeIn>
        <FadeIn delay={0.6}>
          <ActivityTimeline entries={timeline} />
        </FadeIn>
      </div>
    </div>
  );
}
