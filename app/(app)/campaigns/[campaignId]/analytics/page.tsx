import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangleIcon,
  CalendarCheckIcon,
  EyeIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MailCheckIcon,
  MailWarningIcon,
  MessageCircleReplyIcon,
  MousePointerClickIcon,
  SendIcon,
  ThumbsUpIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaign,
  getOrCreateOrganizationForUser,
  listAnalyticsEvents,
  listCampaignLeads,
  listEmailEvents,
  listMailboxes,
  listSendAttemptsForCampaignLeads,
  listSequences,
  listSequenceSteps,
} from "@/lib/db";
import { bucketByDayInRange, previousDateRange, resolveDateRange } from "@/lib/analytics/aggregations";
import { summarizeCampaignMetrics } from "@/lib/analytics/campaign-metrics";
import { compareMetrics } from "@/lib/analytics/comparisons";
import { calculateFunnelConversions, identifyBiggestDropOff } from "@/lib/analytics/funnel";
import { getForecaster, summarizeForecast } from "@/lib/analytics/forecasting";
import { collectInsights, forecastToInsight, healthFactorsToInsights, trendToInsight } from "@/lib/analytics/insights";
import { groupCounts, total } from "@/lib/analytics/metrics";
import {
  identifyBestStep,
  identifyBiggestStepDropOff,
  identifyWeakestStep,
  summarizeSequenceSteps,
  type SequenceStepMetricsInput,
} from "@/lib/analytics/sequence-step-metrics";
import { ANALYTICS_RANGE_OPTIONS, type DateRangePreset } from "@/lib/analytics/types";
import { dateRangeQuerySchema } from "@/lib/validations/analytics";
import { calculateCampaignHealthScore } from "@/lib/campaigns/health-score";
import { buildCampaignMailboxInsights } from "@/lib/campaigns/mailbox-insights";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendCard } from "@/components/dashboard/trend-card";
import { PercentageCard } from "@/components/dashboard/percentage-card";
import { StatusCard } from "@/components/dashboard/status-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FunnelCard, type FunnelStage } from "@/components/dashboard/funnel-card";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { SequenceStepPerformanceTable } from "@/components/analytics/sequence-step-performance-table";
import { HealthScoreCard } from "@/components/analytics/health-score-card";
import { InsightsCard } from "@/components/analytics/insights-card";
import { CampaignMailboxInsightsCard } from "@/components/campaigns/campaign-mailbox-insights";

// Single-campaign scope, so a generous limit (unlike the org-wide
// /analytics page's 500) still comfortably covers a campaign's full
// history without pagination.
const EVENT_FETCH_LIMIT = 5000;
const FORECAST_HORIZON_DAYS = 7;

function attemptTimestamp(attempt: { resolved_at: string | null; claimed_at: string }) {
  return attempt.resolved_at ?? attempt.claimed_at;
}

export default async function CampaignAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const { campaignId } = await params;
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  let campaign;
  try {
    campaign = await getCampaign(supabase, user.id, campaignId);
  } catch {
    notFound();
  }

  const namePrefix = user.email?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);

  const query = await searchParams;
  const parsedQuery = dateRangeQuerySchema.safeParse({ preset: query.range ?? "7d", start: query.start, end: query.end });
  const preset: DateRangePreset = parsedQuery.success ? parsedQuery.data.preset : "7d";
  const currentRange =
    preset === "custom" && parsedQuery.success && parsedQuery.data.start && parsedQuery.data.end
      ? resolveDateRange("custom", { start: parsedQuery.data.start, end: parsedQuery.data.end })
      : resolveDateRange(preset === "custom" ? "7d" : preset);
  const priorRange = previousDateRange(currentRange);

  const [campaignLeads, emailEvents, analyticsEvents, mailboxes] = await Promise.all([
    listCampaignLeads(supabase, campaignId),
    listEmailEvents(supabase, campaignId, { limit: EVENT_FETCH_LIMIT }),
    listAnalyticsEvents(supabase, organization.id, {
      subjectType: "campaign",
      subjectId: campaignId,
      limit: EVENT_FETCH_LIMIT,
    }),
    listMailboxes(supabase, user.id),
  ]);

  const leadIds = (campaignLeads ?? []).map((row) => row.id);
  const [sendAttemptsResult, sequences] = await Promise.all([
    listSendAttemptsForCampaignLeads(supabase, leadIds),
    listSequences(supabase, campaignId),
  ]);
  const sendAttempts = sendAttemptsResult ?? [];
  const events = emailEvents ?? [];
  const sentAttempts = sendAttempts.filter((attempt) => attempt.status === "sent");

  // Sequences aren't a user-facing concept yet — every campaign has at most
  // one, created lazily on first step add (see getOrCreateDefaultSequence).
  const sequence = sequences?.[0] ?? null;
  const sequenceSteps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];

  // --- Mailbox intelligence (Phase 2F commit 5) — plain-language insights
  // across the mailboxes this campaign actually sends from, built entirely
  // on lib/campaigns/mailbox-insights.ts's buildCampaignMailboxInsights,
  // which internally filters listMailboxes()'s full result down to only the
  // mailboxes this campaign's leads resolve to (via the same
  // resolveLeadMailboxId lib/campaigns/readiness.ts's launch-readiness
  // check already uses) before generating anything.
  const mailboxInsights = buildCampaignMailboxInsights({
    campaign,
    campaignLeads: campaignLeads ?? [],
    sendAttempts,
    emailEvents: events,
    mailboxes: mailboxes ?? [],
  });

  // --- Campaign Overview (all-time) — reuses lib/analytics/metrics.ts's
  // groupCounts + lib/analytics/campaign-metrics.ts's summarizeCampaignMetrics
  // rather than a bespoke calculation.
  const eventCounts = groupCounts(events, (event) => event.event_type);
  const analyticsCounts = groupCounts(analyticsEvents, (event) => event.event_type);

  const overview = summarizeCampaignMetrics({
    sentCount: sentAttempts.length,
    deliveredCount: eventCounts.delivered ?? 0,
    openedCount: eventCounts.opened ?? 0,
    clickedCount: eventCounts.clicked ?? 0,
    repliedCount: eventCounts.replied ?? 0,
    bouncedCount: eventCounts.bounced ?? 0,
    positiveReplyCount: analyticsCounts.positive_reply ?? 0,
    meetingBookedCount: analyticsCounts.meeting_booked ?? 0,
  });

  // --- Campaign Timeline + Trends — reuses lib/analytics/aggregations.ts's
  // bucketByDayInRange for both the daily chart data and (via total()) the
  // period totals that feed the trend comparison, so there's only one pass
  // over each timestamp list per metric.
  const sentTimestamps = sentAttempts.map(attemptTimestamp);
  const repliedTimestamps = events.filter((e) => e.event_type === "replied").map((e) => e.created_at);
  const openedTimestamps = events.filter((e) => e.event_type === "opened").map((e) => e.created_at);
  const clickedTimestamps = events.filter((e) => e.event_type === "clicked").map((e) => e.created_at);

  const dailySends = bucketByDayInRange(sentTimestamps, currentRange);
  const dailyReplies = bucketByDayInRange(repliedTimestamps, currentRange);
  const dailyOpens = bucketByDayInRange(openedTimestamps, currentRange);
  const dailyClicks = bucketByDayInRange(clickedTimestamps, currentRange);

  const sendsTotal = total(dailySends.map((d) => d.value));
  const repliesTotal = total(dailyReplies.map((d) => d.value));
  const opensTotal = total(dailyOpens.map((d) => d.value));
  const clicksTotal = total(dailyClicks.map((d) => d.value));

  // --- Forecast — reuses lib/analytics/forecasting.ts's LinearTrendForecaster
  // directly over dailySends, the exact same series the "Daily sends" chart
  // below renders, so this needs no extra query beyond what Trends already
  // fetched.
  const sendForecast = await getForecaster().forecast(dailySends, FORECAST_HORIZON_DAYS);
  const forecastSummary = summarizeForecast(sendForecast);

  const priorSends = total(bucketByDayInRange(sentTimestamps, priorRange).map((d) => d.value));
  const priorReplies = total(bucketByDayInRange(repliedTimestamps, priorRange).map((d) => d.value));
  const priorOpens = total(bucketByDayInRange(openedTimestamps, priorRange).map((d) => d.value));
  const priorClicks = total(bucketByDayInRange(clickedTimestamps, priorRange).map((d) => d.value));

  // Trend calculations reuse the existing trend engine (compareMetrics ->
  // calculateTrend) directly — see lib/analytics/trends.ts.
  const trends = compareMetrics(
    { sends: sendsTotal, replies: repliesTotal, opens: opensTotal, clicks: clicksTotal },
    { sends: priorSends, replies: priorReplies, opens: priorOpens, clicks: priorClicks },
  );

  // --- Funnel (all-time) — "Leads"/"Queued" come from campaign_leads'
  // current state (enrolled count, and how many are still pending/active in
  // the sending queue — see claim_due_sends()); everything from "Sent"
  // onward is the same email_events/analytics_events-derived overview
  // above. "Won" is a placeholder: no deals/revenue table exists yet, so
  // it's never queried, only shown as the seam a future Revenue Analytics
  // feature fills in without restructuring the funnel.
  //
  // Note: "Queued" (a snapshot of leads currently pending/active) can be
  // smaller than "Sent" (an all-time cumulative count) once a campaign has
  // been running a while and most leads have already moved past active
  // sending into a terminal state (completed/replied/etc.) — that's
  // expected, not a data error, and calculateFunnelDropOffs (below) already
  // clamps that case to a 0% drop-off rather than a fabricated negative one.
  const allEnrolledLeads = campaignLeads ?? [];
  const leadsCount = allEnrolledLeads.length;
  const queuedCount = allEnrolledLeads.filter((lead) => lead.status === "pending" || lead.status === "active").length;

  const funnelStages: FunnelStage[] = [
    { key: "leads", label: "Leads", value: leadsCount },
    { key: "queued", label: "Queued", value: queuedCount },
    { key: "sent", label: "Sent", value: overview.sentCount },
    { key: "delivered", label: "Delivered", value: overview.deliveredCount },
    { key: "opened", label: "Opened", value: overview.openedCount },
    { key: "clicked", label: "Clicked", value: overview.clickedCount },
    { key: "replied", label: "Replied", value: overview.repliedCount },
    { key: "positive_reply", label: "Positive reply", value: overview.positiveReplyCount },
    { key: "meeting_booked", label: "Meeting booked", value: overview.meetingBookedCount },
    { key: "won", label: "Won", value: 0, placeholder: true },
  ];

  // --- Funnel intelligence (Phase 2F) — reuses lib/analytics/funnel.ts's
  // pure conversion/drop-off math over the exact same funnelStages array
  // FunnelCard renders, so there's one source of truth for "what the
  // funnel looks like" instead of a second calculation.
  const funnelConversions = calculateFunnelConversions(funnelStages);
  const meetingConversion = funnelConversions.find((stage) => stage.key === "meeting_booked")?.conversionFromStart ?? null;
  const biggestDropOff = identifyBiggestDropOff(funnelStages);

  // --- Sequence step analytics (Phase 2F commit 2) — sent counts come
  // directly from send_attempts.sequence_step_id (no correlation needed);
  // reply counts are attributed via the provider_message_id chain
  // record_send_success/reply-worker.ts already establish — see
  // lib/analytics/sequence-step-metrics.ts for exactly how. All-time, same
  // scope as the funnel above, not the date-range-filtered Trends section.
  const stepInputs: SequenceStepMetricsInput[] = (sequenceSteps ?? []).map((step, index) => ({
    stepId: step.id,
    order: index + 1,
    label: step.subject || `Step ${index + 1}`,
  }));
  const stepSummaries = summarizeSequenceSteps(stepInputs, sendAttempts, events);
  const bestStep = identifyBestStep(stepSummaries);
  const weakestStep = identifyWeakestStep(stepSummaries);
  const biggestStepDropOff = identifyBiggestStepDropOff(stepSummaries);

  // --- Campaign health score (Phase 2F commit 3) — bounceRate/replyRate are
  // real signals, reused straight from overview (summarizeCampaignMetrics).
  // deliveryRate/positiveReplyRate/meetingRate are deliberately passed as
  // null, NOT overview.deliveryRate / rate(overview.positiveReplyCount, ...)
  // / rate(overview.meetingBookedCount, ...) — delivered/positive_reply/
  // meeting_booked have zero producers anywhere in the codebase (see
  // lib/analytics/funnel.ts's UNTRACKED_STAGE_KEYS and
  // lib/db/analytics.ts's insertAnalyticsEvent, never called), so their
  // counts are always exactly 0. rate(0, sentCount) returns a real 0, not
  // null, whenever sentCount > 0 — feeding that through would silently
  // score three phantom "0% signals" into every campaign's health score
  // instead of excluding them, exactly the fabricated-metric trap
  // lib/campaigns/health-score.ts's own field comments warn against. Update
  // these three the moment a real producer exists — everything else here
  // (engagementTrend, biggestStepDropOff) is already real.
  const healthScore = calculateCampaignHealthScore({
    bounceRate: overview.bounceRate,
    replyRate: overview.replyRate,
    deliveryRate: null,
    positiveReplyRate: null,
    meetingRate: null,
    engagementTrend: trends.replies,
    biggestStepDropOff,
  });

  // --- AI Insights — deterministic, rule-based (no LLM): every candidate
  // below adapts an output already computed above (health-score factors,
  // the reply/send trend, the send forecast's own trajectory) rather than
  // recomputing anything. See lib/analytics/insights.ts.
  const aiInsights = collectInsights(
    [
      ...healthFactorsToInsights(healthScore.factors),
      trendToInsight("replies", "Reply volume", trends.replies),
      trendToInsight("sends", "Send volume", trends.sends),
      forecastToInsight("Sends", sendForecast),
    ],
    "No notable changes for this campaign right now — everything is steady.",
  );

  const activeRangeLabel = ANALYTICS_RANGE_OPTIONS.find((option) => option.preset === preset)?.label ?? "selected range";

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{campaign.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">Campaign analytics and performance.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/campaigns/${campaignId}`}>Back to campaign</Link>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div>
          <h2 className="font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">All-time totals for this campaign.</p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <FadeIn delay={0.1}>
            <StatCard title="Emails sent" value={overview.sentCount} icon={<SendIcon className="size-4" />} isEmpty={overview.sentCount === 0} emptyHint="Will appear once this campaign starts sending." />
          </FadeIn>
          <FadeIn delay={0.12}>
            <StatCard title="Delivered" value={overview.deliveredCount} icon={<MailCheckIcon className="size-4" />} isEmpty={overview.deliveredCount === 0} emptyHint="Delivery confirmations aren't tracked yet." />
          </FadeIn>
          <FadeIn delay={0.14}>
            <StatCard title="Opened" value={overview.openedCount} icon={<EyeIcon className="size-4" />} isEmpty={overview.openedCount === 0} emptyHint="Will appear once a lead opens an email." />
          </FadeIn>
          <FadeIn delay={0.16}>
            <StatCard title="Clicked" value={overview.clickedCount} icon={<MousePointerClickIcon className="size-4" />} isEmpty={overview.clickedCount === 0} emptyHint="Will appear once a lead clicks a link." />
          </FadeIn>
          <FadeIn delay={0.18}>
            <StatCard title="Replies" value={overview.repliedCount} icon={<MessageCircleReplyIcon className="size-4" />} isEmpty={overview.repliedCount === 0} emptyHint="Will appear once a lead replies." />
          </FadeIn>
          <FadeIn delay={0.2}>
            <StatCard
              title="Positive replies"
              value={overview.positiveReplyCount}
              icon={<ThumbsUpIcon className="size-4" />}
              isEmpty={overview.positiveReplyCount === 0}
              emptyHint="Sourced from the analytics event model — populates once reply sentiment is recorded there."
            />
          </FadeIn>
          <FadeIn delay={0.22}>
            <StatCard
              title="Meetings booked"
              value={overview.meetingBookedCount}
              icon={<CalendarCheckIcon className="size-4" />}
              isEmpty={overview.meetingBookedCount === 0}
              emptyHint="Sourced from the analytics event model — populates once meeting bookings are recorded there."
            />
          </FadeIn>
          <FadeIn delay={0.24}>
            <PercentageCard title="Delivery rate" value={overview.deliveryRate} icon={<MailCheckIcon className="size-4" />} description="Delivered ÷ sent" />
          </FadeIn>
          <FadeIn delay={0.26}>
            <PercentageCard title="Open rate" value={overview.openRate} icon={<EyeIcon className="size-4" />} description="Opened ÷ delivered" />
          </FadeIn>
          <FadeIn delay={0.28}>
            <PercentageCard title="Reply rate" value={overview.replyRate} icon={<MessageCircleReplyIcon className="size-4" />} description="Replied ÷ sent" />
          </FadeIn>
          <FadeIn delay={0.3}>
            <PercentageCard title="Bounce rate" value={overview.bounceRate} icon={<MailWarningIcon className="size-4" />} description="Bounced ÷ sent" />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.32}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Campaign health</h2>
          <p className="text-sm text-muted-foreground">
            A single explainable score, weighted from whichever signals below have real data today.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.33}>
        <HealthScoreCard
          title="Campaign health"
          description="Weighted from every signal with real data today."
          emptyTitle="Not enough data yet"
          emptyDescription="A health score appears once this campaign has real bounce/reply data, an engagement trend, or step performance to measure."
          score={healthScore.score}
          factors={healthScore.factors}
        />
      </FadeIn>

      <FadeIn delay={0.34}>
        <InsightsCard
          title="AI Insights"
          description="Deterministic, rule-based callouts from this campaign's health score, trends, and forecast."
          insights={aiInsights}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 sm:pt-8">
          <div>
            <h2 className="font-semibold tracking-tight">Trends</h2>
            <p className="text-sm text-muted-foreground">
              Daily activity and trend vs. the previous {activeRangeLabel.toLowerCase()}.
            </p>
          </div>
          <DateRangePicker
            basePath={`/campaigns/${campaignId}/analytics`}
            preset={preset}
            currentRange={currentRange}
            options={ANALYTICS_RANGE_OPTIONS}
          />
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-4">
          <FadeIn delay={0.4}>
            <TrendCard title="Sends" value={sendsTotal} trend={trends.sends} icon={<SendIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.42}>
            <TrendCard title="Replies" value={repliesTotal} trend={trends.replies} icon={<MessageCircleReplyIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.44}>
            <TrendCard title="Opens" value={opensTotal} trend={trends.opens} icon={<EyeIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.46}>
            <TrendCard title="Clicks" value={clicksTotal} trend={trends.clicks} icon={<MousePointerClickIcon className="size-4" />} />
          </FadeIn>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.5}>
          <DailyBarChart title="Daily sends" description={`Sends across the selected range.`} data={dailySends} />
        </FadeIn>
        <FadeIn delay={0.52}>
          <DailyBarChart title="Daily replies" description={`Replies across the selected range.`} data={dailyReplies} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
        <FadeIn delay={0.54}>
          <DailyBarChart title="Daily opens" description={`Opens across the selected range.`} data={dailyOpens} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
        <FadeIn delay={0.56}>
          <DailyBarChart title="Daily clicks" description={`Clicks across the selected range.`} data={dailyClicks} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
      </div>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2">
          <FadeIn delay={0.58}>
            <StatCard
              title={`Projected sends, next ${FORECAST_HORIZON_DAYS} days`}
              value={forecastSummary ? forecastSummary.projectedTotal : "—"}
              icon={<TrendingUpIcon className="size-4" />}
              isEmpty={!forecastSummary}
              emptyHint="Needs at least two days of send history in this range to project a trend."
              description={
                forecastSummary
                  ? `${Math.round(forecastSummary.averageConfidence * 100)}% average confidence, from the daily sends trend above`
                  : undefined
              }
            />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.6}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Funnel</h2>
          <p className="text-sm text-muted-foreground">
            All-time conversion path for this campaign, from every enrolled lead through to a booked meeting.
          </p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2">
          <FadeIn delay={0.63}>
            <StatCard
              title="Leads in funnel"
              value={leadsCount}
              icon={<UsersIcon className="size-4" />}
              isEmpty={leadsCount === 0}
              emptyHint="No leads enrolled yet."
            />
          </FadeIn>
          <FadeIn delay={0.65}>
            <PercentageCard
              title="Lead → meeting conversion"
              value={meetingConversion}
              icon={<CalendarCheckIcon className="size-4" />}
              description="Meetings booked ÷ leads enrolled"
            />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.67}>
        <FunnelCard
          title="Campaign funnel"
          description="Leads through to won — Won is a placeholder for a future Revenue Analytics integration."
          stages={funnelStages}
        />
      </FadeIn>

      <FadeIn delay={0.7}>
        {biggestDropOff ? (
          <StatusCard
            title="Biggest drop-off"
            status={`${biggestDropOff.fromLabel} → ${biggestDropOff.toLabel}`}
            tone="destructive"
            icon={<TrendingDownIcon className="size-4" />}
            description={`${biggestDropOff.dropOffPercent}% of leads didn't make it from ${biggestDropOff.fromLabel.toLowerCase()} to ${biggestDropOff.toLabel.toLowerCase()} (${biggestDropOff.droppedCount} of ${biggestDropOff.fromValue}).`}
          />
        ) : (
          <EmptyState
            icon={<ListTodoIcon className="size-5" />}
            title="Not enough data yet to identify a drop-off"
            description="This appears once the funnel has real activity to compare between two stages."
          />
        )}
      </FadeIn>

      <FadeIn delay={0.75}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Sequence step analytics</h2>
          <p className="text-sm text-muted-foreground">All-time performance per touch in this campaign&apos;s sequence.</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.77}>
        <SequenceStepPerformanceTable steps={stepSummaries} />
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.79}>
          {bestStep ? (
            <StatusCard
              title="Best step"
              status={bestStep.label}
              tone="default"
              icon={<TrophyIcon className="size-4" />}
              description={`${bestStep.replyRate}% reply rate (${bestStep.repliedCount} of ${bestStep.sentCount} sent).`}
            />
          ) : (
            <EmptyState
              icon={<TrophyIcon className="size-5" />}
              title="Not enough data yet"
              description="A best-performing step is identified once at least one step has sends and a measurable reply rate."
            />
          )}
        </FadeIn>
        <FadeIn delay={0.81}>
          {weakestStep ? (
            <StatusCard
              title="Weakest step"
              status={weakestStep.label}
              tone="secondary"
              icon={<AlertTriangleIcon className="size-4" />}
              description={`${weakestStep.replyRate}% reply rate (${weakestStep.repliedCount} of ${weakestStep.sentCount} sent).`}
            />
          ) : (
            <EmptyState
              icon={<AlertTriangleIcon className="size-5" />}
              title="Not enough data yet"
              description="A weakest-performing step is identified once at least one step has sends and a measurable reply rate."
            />
          )}
        </FadeIn>
      </div>

      <FadeIn delay={0.83}>
        {biggestStepDropOff ? (
          <StatusCard
            title="Biggest drop-off between steps"
            status={`${biggestStepDropOff.fromLabel} → ${biggestStepDropOff.toLabel}`}
            tone="destructive"
            icon={<TrendingDownIcon className="size-4" />}
            description={`${biggestStepDropOff.dropOffPercent}% fewer leads reached ${biggestStepDropOff.toLabel.toLowerCase()} than sent ${biggestStepDropOff.fromLabel.toLowerCase()} (${biggestStepDropOff.droppedCount} of ${biggestStepDropOff.fromValue}).`}
          />
        ) : (
          <EmptyState
            icon={<ListOrderedIcon className="size-5" />}
            title="Not enough data yet to compare steps"
            description="This appears once at least two sequence steps have real sends to compare."
          />
        )}
      </FadeIn>

      <FadeIn delay={0.85}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Mailbox intelligence</h2>
          <p className="text-sm text-muted-foreground">
            Plain-language insights across this campaign&apos;s sending mailboxes.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.87}>
        <CampaignMailboxInsightsCard mailboxes={mailboxInsights.mailboxes} insights={mailboxInsights.insights} />
      </FadeIn>
    </div>
  );
}
