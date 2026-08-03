import Link from "next/link";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CalendarClockIcon,
  MailCheckIcon,
  MailWarningIcon,
  MessageCircleReplyIcon,
  SendIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countEmailEventsByType,
  countSendAttemptsByStatus,
  getOrCreateOrganizationForUser,
  listAnalyticsEvents,
  listCampaignLeads,
  listCampaigns,
  listEmailEvents,
  listSendAttempts,
  listSendAttemptsForCampaignLeads,
} from "@/lib/db";
import { bucketByDay } from "@/lib/analytics/time-buckets";
import { classifyErrorCategory, type ErrorCategory } from "@/lib/analytics/error-category";
import { previousDateRange, resolveDateRange } from "@/lib/analytics/aggregations";
import { calculatePeerAverage, compareToBenchmark } from "@/lib/analytics/benchmarks";
import { compareMetrics } from "@/lib/analytics/comparisons";
import { ANALYTICS_EVENT_LABELS } from "@/lib/analytics/events";
import { getForecaster, summarizeForecast } from "@/lib/analytics/forecasting";
import { benchmarkToInsight, collectInsights, forecastToInsight, type Insight } from "@/lib/analytics/insights";
import { groupCounts, rate } from "@/lib/analytics/metrics";
import { loadOrganizationRollup } from "@/lib/analytics/organization-rollup";
import type { AnalyticsEventType } from "@/lib/analytics/types";
import { dateRangeQuerySchema } from "@/lib/validations/analytics";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendCard } from "@/components/dashboard/trend-card";
import { PercentageCard } from "@/components/dashboard/percentage-card";
import { ComparisonCard, type ComparisonRow } from "@/components/dashboard/comparison-card";
import { StatusCard } from "@/components/dashboard/status-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { CampaignPerformanceTable, type CampaignPerformanceRow } from "@/components/analytics/campaign-performance-table";
import { FailureAnalysis } from "@/components/analytics/failure-analysis";
import { ActivityTimeline, type TimelineEntry } from "@/components/analytics/activity-timeline";
import { InsightsCard } from "@/components/analytics/insights-card";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { RollupTable, type RollupRow } from "@/components/analytics/rollup-table";

const CHART_WINDOW_DAYS = 14;
const ANALYTICS_ROW_LIMIT = 500;
const TIMELINE_LIMIT = 20;
const FORECAST_HORIZON_DAYS = 7;

const RANGE_OPTIONS: { preset: "today" | "7d" | "30d" | "90d"; label: string }[] = [
  { preset: "today", label: "Today" },
  { preset: "7d", label: "7 Days" },
  { preset: "30d", label: "30 Days" },
  { preset: "90d", label: "90 Days" },
];

// Foundation-section metrics — a small, deliberately narrow slice of the
// full event catalog (see lib/analytics/events.ts) to keep this section
// focused; the metrics engine underneath supports every event type without
// changes once more of them are worth surfacing here.
const FOUNDATION_METRIC_TYPES: AnalyticsEventType[] = ["email_sent", "replied", "positive_reply", "meeting_booked"];

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
  replied: "secondary",
  bounced: "destructive",
  failed: "destructive",
  unsubscribed: "secondary",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  const [
    campaigns,
    totalAttempts,
    sentCount,
    failedCount,
    bouncedCount,
    deliveredCount,
    repliedCount,
    sendAttempts,
    emailEvents,
  ] = await Promise.all([
    listCampaigns(supabase, user.id),
    countSendAttemptsByStatus(supabase),
    countSendAttemptsByStatus(supabase, "sent"),
    countSendAttemptsByStatus(supabase, "failed"),
    countEmailEventsByType(supabase, "bounced"),
    countEmailEventsByType(supabase, "delivered"),
    countEmailEventsByType(supabase, "replied"),
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

  // Reuses lib/analytics/forecasting.ts's LinearTrendForecaster over
  // dailyVolume, the same series "Sending volume by day" renders below — no
  // extra query beyond what this page already fetched.
  const sendForecast = await getForecaster().forecast(dailyVolume, FORECAST_HORIZON_DAYS);
  const sendForecastSummary = summarizeForecast(sendForecast);

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
      title: "Replies",
      value: repliedCount,
      icon: <MessageCircleReplyIcon className="size-4" />,
      description: "Replies detected across all campaigns",
      emptyHint: "Will appear once a lead replies.",
      isEmpty: repliedCount === 0,
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

  // --- Analytics Foundation section (below) -------------------------------
  // Everything above this point is the existing send_attempts/email_events
  // dashboard, untouched. This section is additive: it demonstrates the
  // new organization-scoped event model (analytics_events) and the
  // reusable metrics/trend/comparison engine (lib/analytics/) that future
  // dashboards will build on — Campaign/Mailbox/Domain/Warmup/Revenue
  // Analytics, AI Insights, etc. Nothing writes to analytics_events yet
  // (see the migration), so this section renders an honest empty state
  // until a producer (a future sending-worker/reply-worker/warmup
  // integration) starts recording events — it never fabricates numbers to
  // look populated.
  const namePrefix = user.email?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);

  // --- Organization rollup (below) -----------------------------------------
  // All-time totals across every campaign, mailbox, and domain — the last
  // gap ROADMAP.md's Analytics section flagged as not yet built. Fetch
  // orchestration is isolated behind loadOrganizationRollup() rather than
  // looped here, so a future batched implementation only touches that one
  // function; this page just maps its snapshots into RollupTable rows.
  const rollup = await loadOrganizationRollup(supabase, user.id, organization.id);

  // --- Benchmarks — reuses lib/analytics/benchmarks.ts's
  // calculatePeerAverage/compareToBenchmark over the overview snapshots
  // already loaded above by loadOrganizationRollup, strictly within this
  // organization's own campaigns/mailboxes/domains (never across
  // organizations). One peer average per entity type, computed once and
  // compared against each entity of that type below.
  const campaignReplyRatePeerAverage = calculatePeerAverage(
    rollup.campaignSnapshots.map((snapshot) => ({ replyRate: snapshot.overview.replyRate })),
  );
  const mailboxReplyRatePeerAverage = calculatePeerAverage(
    rollup.mailboxSnapshots.map((snapshot) => ({ replyRate: snapshot.overview.replyRate })),
  );
  const domainReplyRatePeerAverage = calculatePeerAverage(
    rollup.domainSnapshots.map((snapshot) => ({ replyRate: snapshot.overview.replyRate })),
  );

  const campaignRollupRows: RollupRow[] = rollup.campaignSnapshots.map((snapshot) => ({
    key: snapshot.campaign.id,
    label: snapshot.campaign.name,
    href: `/campaigns/${snapshot.campaign.id}/analytics`,
    sentCount: snapshot.overview.sentCount,
    replyRate: snapshot.overview.replyRate,
    bounceRate: snapshot.overview.bounceRate,
    healthScore: snapshot.healthScore.score,
    replyRateBenchmark:
      compareToBenchmark({ replyRate: snapshot.overview.replyRate }, campaignReplyRatePeerAverage).replyRate ?? null,
  }));

  const mailboxRollupRows: RollupRow[] = rollup.mailboxSnapshots.map((snapshot) => ({
    key: snapshot.mailbox.id,
    label: snapshot.mailbox.display_name || snapshot.mailbox.email,
    href: `/mailboxes/${snapshot.mailbox.id}/analytics`,
    sentCount: snapshot.overview.sentCount,
    replyRate: snapshot.overview.replyRate,
    bounceRate: snapshot.overview.bounceRate,
    healthScore: snapshot.health?.health_score ?? null,
    replyRateBenchmark:
      compareToBenchmark({ replyRate: snapshot.overview.replyRate }, mailboxReplyRatePeerAverage).replyRate ?? null,
  }));

  const domainRollupRows: RollupRow[] = rollup.domainSnapshots.map((snapshot) => ({
    key: snapshot.domain.id,
    label: snapshot.domain.domain,
    href: `/settings/deliverability/${snapshot.domain.id}/analytics`,
    sentCount: snapshot.overview.sentCount,
    replyRate: snapshot.overview.replyRate,
    bounceRate: snapshot.overview.bounceRate,
    healthScore: snapshot.healthScore.score,
    replyRateBenchmark:
      compareToBenchmark({ replyRate: snapshot.overview.replyRate }, domainReplyRatePeerAverage).replyRate ?? null,
  }));

  // --- AI Insights — deterministic, rule-based (no LLM): one benchmark
  // callout per campaign/mailbox/domain that's significantly off its own
  // peer-group average (reusing the replyRateBenchmark already computed
  // for each rollup row above), plus the org-wide send forecast computed
  // earlier on this page.
  const rollupBenchmarkInsights: (Insight | null)[] = [
    ...campaignRollupRows.map((row) => (row.replyRateBenchmark ? benchmarkToInsight(row.label, "reply rate", row.replyRateBenchmark) : null)),
    ...mailboxRollupRows.map((row) => (row.replyRateBenchmark ? benchmarkToInsight(row.label, "reply rate", row.replyRateBenchmark) : null)),
    ...domainRollupRows.map((row) => (row.replyRateBenchmark ? benchmarkToInsight(row.label, "reply rate", row.replyRateBenchmark) : null)),
  ];
  const aiInsights = collectInsights(
    [...rollupBenchmarkInsights, forecastToInsight("Sending volume", sendForecast)],
    "No notable changes across your organization right now — everything is steady.",
  );

  const rangeParam = (await searchParams).range;
  const parsedRange = dateRangeQuerySchema.safeParse({ preset: rangeParam });
  const preset = parsedRange.success ? parsedRange.data.preset : "7d";
  const currentRange = resolveDateRange(preset === "custom" ? "7d" : preset);
  const priorRange = previousDateRange(currentRange);

  const [currentEvents, priorEvents] = await Promise.all([
    listAnalyticsEvents(supabase, organization.id, {
      since: `${currentRange.start}T00:00:00.000Z`,
      until: `${currentRange.end}T23:59:59.999Z`,
    }),
    listAnalyticsEvents(supabase, organization.id, {
      since: `${priorRange.start}T00:00:00.000Z`,
      until: `${priorRange.end}T23:59:59.999Z`,
    }),
  ]);

  const currentCountsByType = groupCounts(currentEvents, (event) => event.event_type);
  const priorCountsByType = groupCounts(priorEvents, (event) => event.event_type);

  const currentMetrics: Record<string, number> = {};
  const priorMetrics: Record<string, number> = {};
  for (const type of FOUNDATION_METRIC_TYPES) {
    currentMetrics[type] = currentCountsByType[type] ?? 0;
    priorMetrics[type] = priorCountsByType[type] ?? 0;
  }
  const foundationTrends = compareMetrics(currentMetrics, priorMetrics);

  const emailsSentInRange = currentCountsByType.email_sent ?? 0;
  const repliesInRange = currentCountsByType.replied ?? 0;
  const eventReplyRate = rate(repliesInRange, emailsSentInRange);

  const comparisonRows: ComparisonRow[] = FOUNDATION_METRIC_TYPES.map((type) => ({
    key: type,
    label: ANALYTICS_EVENT_LABELS[type],
    currentValue: currentMetrics[type],
    trend: foundationTrends[type],
  }));

  const hasAnyFoundationEvents = currentEvents.length > 0 || priorEvents.length > 0;

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

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2">
          <FadeIn delay={0.48}>
            <StatCard
              title={`Projected sends, next ${FORECAST_HORIZON_DAYS} days`}
              value={sendForecastSummary ? sendForecastSummary.projectedTotal : "—"}
              icon={<TrendingUpIcon className="size-4" />}
              isEmpty={!sendForecastSummary}
              emptyHint="Needs at least two days of send history to project a trend."
              description={
                sendForecastSummary
                  ? `${Math.round(sendForecastSummary.averageConfidence * 100)}% average confidence, from the sending volume trend above`
                  : undefined
              }
            />
          </FadeIn>
        </div>
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

      <FadeIn delay={0.65}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 sm:pt-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Event-based analytics</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Foundation for future campaign, mailbox, domain, and warmup analytics — built on a generic event
              model rather than this page&apos;s existing send-attempt queries.
            </p>
          </div>
          <div className="flex gap-1.5">
            {RANGE_OPTIONS.map((option) => (
              <Link key={option.preset} href={`/analytics?range=${option.preset}`}>
                <Badge variant={preset === option.preset ? "default" : "outline"} className="cursor-pointer">
                  {option.label}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      </FadeIn>

      {!hasAnyFoundationEvents ? (
        <FadeIn delay={0.7}>
          <EmptyState
            icon={<ActivityIcon className="size-5" />}
            title="No analytics events recorded yet"
            description="This section reads from the new organization-scoped event model. It will populate once campaigns, warmup, and deliverability start recording events into it."
          />
        </FadeIn>
      ) : (
        <>
          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
              <FadeIn delay={0.7}>
                <TrendCard
                  title={ANALYTICS_EVENT_LABELS.email_sent}
                  value={currentMetrics.email_sent}
                  trend={foundationTrends.email_sent}
                  icon={<SendIcon className="size-4" />}
                  description={`vs. the previous ${RANGE_OPTIONS.find((o) => o.preset === preset)?.label.toLowerCase()}`}
                />
              </FadeIn>
              <FadeIn delay={0.75}>
                <TrendCard
                  title={ANALYTICS_EVENT_LABELS.meeting_booked}
                  value={currentMetrics.meeting_booked}
                  trend={foundationTrends.meeting_booked}
                  icon={<TrendingUpIcon className="size-4" />}
                  description="Positive outcomes recorded"
                />
              </FadeIn>
              <FadeIn delay={0.8}>
                <PercentageCard
                  title="Reply rate"
                  value={eventReplyRate}
                  icon={<MessageCircleReplyIcon className="size-4" />}
                  description="Replied ÷ emails sent, this range"
                />
              </FadeIn>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <FadeIn delay={0.85}>
              <ComparisonCard
                title="This period vs. last period"
                description="Every foundation metric, compared to the equivalent range before it."
                rows={comparisonRows}
              />
            </FadeIn>
            <FadeIn delay={0.9}>
              <StatusCard
                title="Event collection"
                status="Active"
                tone="default"
                icon={<CalendarClockIcon className="size-4" />}
                description="Events are being recorded for this organization."
              />
            </FadeIn>
          </div>
        </>
      )}

      <FadeIn delay={0.95}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="text-xl font-semibold tracking-tight">Organization rollup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All-time totals across every campaign, mailbox, and domain in this organization, each benchmarked against
            its own peer-group average reply rate.
          </p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <MailboxMetricsOverviewCards summary={rollup.overview} delayStart={1} />
        </div>
      </div>

      <FadeIn delay={1.1}>
        <RollupTable
          title="Campaigns"
          description="Every campaign's all-time sent volume, reply rate, bounce rate, and health score."
          emptyLabel="No campaigns yet."
          rows={campaignRollupRows}
        />
      </FadeIn>

      <FadeIn delay={1.15}>
        <RollupTable
          title="Mailboxes"
          description="Every mailbox's all-time sent volume, reply rate, bounce rate, and health score."
          emptyLabel="No mailboxes yet."
          rows={mailboxRollupRows}
        />
      </FadeIn>

      <FadeIn delay={1.2}>
        <RollupTable
          title="Domains"
          description="Every domain's all-time sent volume, reply rate, bounce rate, and health score."
          emptyLabel="No domains yet."
          rows={domainRollupRows}
        />
      </FadeIn>

      <FadeIn delay={1.25}>
        <InsightsCard
          title="AI Insights"
          description="Deterministic, rule-based callouts from the reply-rate benchmarks above and the organization's send forecast."
          insights={aiInsights}
        />
      </FadeIn>
    </div>
  );
}
