import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BadgeCheckIcon,
  CalendarClockIcon,
  FlameIcon,
  GaugeIcon,
  MailCheckIcon,
  MailWarningIcon,
  MessageCircleReplyIcon,
  SendIcon,
  ShieldIcon,
  TrendingUpIcon,
} from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getDomain,
  getLatestRecommendation,
  getMailbox,
  getMailboxHealth,
  getUserOrganization,
  getWarmupProfileByMailbox,
  listAiProviderKeys,
  listAnalyticsEvents,
  listEmailEvents,
  listWarmupEvents,
  listWarmupStats,
} from "@/lib/db";
import type { AiProviderName } from "@/lib/ai/get-provider";
import { bucketByDayInRange, previousDateRange, resolveDateRange } from "@/lib/analytics/aggregations";
import { compareMetrics } from "@/lib/analytics/comparisons";
import { getForecaster, summarizeForecast } from "@/lib/analytics/forecasting";
import { collectInsights, forecastToInsight, trendToInsight } from "@/lib/analytics/insights";
import { summarizeMailboxMetrics } from "@/lib/analytics/mailbox-metrics";
import { groupCounts, rate, total } from "@/lib/analytics/metrics";
import type { DailyCount } from "@/lib/analytics/time-buckets";
import { ANALYTICS_RANGE_OPTIONS, type DateRangePreset } from "@/lib/analytics/types";
import { dateRangeQuerySchema } from "@/lib/validations/analytics";
import { getReputationProvider } from "@/lib/deliverability/get-reputation-provider";
import { forecastNextRamp } from "@/lib/warmup/scheduler";
import type { WarmupEventType, WarmupStage } from "@/lib/warmup/types";
import type { Tables } from "@/types/database.types";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendCard } from "@/components/dashboard/trend-card";
import { PercentageCard } from "@/components/dashboard/percentage-card";
import { StatusCard, type StatusTone } from "@/components/dashboard/status-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { ActivityTimeline, type TimelineEntry } from "@/components/analytics/activity-timeline";
import { InsightsCard } from "@/components/analytics/insights-card";
import { DomainDnsStatus } from "@/components/deliverability/domain-dns-status";
import { MailboxHealthSummary } from "@/components/mailboxes/mailbox-health-summary";
import { RecommendationCard } from "@/components/ai/recommendation-card";
import { generateMailboxRecommendationAction } from "./actions";

// Single-mailbox scope, so a generous limit (like the campaign analytics
// page's) comfortably covers a mailbox's full history without pagination.
const EVENT_FETCH_LIMIT = 5000;
const FORECAST_HORIZON_DAYS = 7;

const STAGE_LABEL: Record<WarmupStage, string> = {
  disabled: "Disabled",
  starting: "Starting",
  warming: "Warming",
  healthy: "Healthy",
  cooling: "Cooling",
  paused: "Paused",
};

const MAILBOX_STATUS_TONE: Record<string, StatusTone> = {
  active: "success",
  paused: "secondary",
  error: "destructive",
};

const WARMUP_EVENT_LABEL: Record<WarmupEventType, string> = {
  status_changed: "Status changed",
  stage_changed: "Stage changed",
  volume_adjusted: "Volume adjusted",
  warning: "Warning",
};

const WARMUP_EVENT_VARIANT: Record<WarmupEventType, TimelineEntry["variant"]> = {
  status_changed: "secondary",
  stage_changed: "default",
  volume_adjusted: "outline",
  warning: "destructive",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isWarmupEventType(value: string): value is WarmupEventType {
  return value in WARMUP_EVENT_LABEL;
}

export default async function MailboxAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ mailboxId: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const { mailboxId } = await params;
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  let mailbox;
  try {
    mailbox = await getMailbox(supabase, user.id, mailboxId);
  } catch {
    notFound();
  }

  const organization = await getUserOrganization(supabase, user);

  const query = await searchParams;
  const parsedQuery = dateRangeQuerySchema.safeParse({ preset: query.range ?? "7d", start: query.start, end: query.end });
  const preset: DateRangePreset = parsedQuery.success ? parsedQuery.data.preset : "7d";
  const currentRange =
    preset === "custom" && parsedQuery.success && parsedQuery.data.start && parsedQuery.data.end
      ? resolveDateRange("custom", { start: parsedQuery.data.start, end: parsedQuery.data.end })
      : resolveDateRange(preset === "custom" ? "7d" : preset);
  const priorRange = previousDateRange(currentRange);

  const [emailEvents, analyticsEvents, warmupProfile, mailboxHealth, reputationSignals, aiProviderKeys, latestRecommendation] =
    await Promise.all([
      listEmailEvents(supabase, undefined, { mailboxId, limit: EVENT_FETCH_LIMIT }),
      listAnalyticsEvents(supabase, organization.id, {
        subjectType: "mailbox",
        subjectId: mailboxId,
        limit: EVENT_FETCH_LIMIT,
      }),
      getWarmupProfileByMailbox(supabase, organization.id, mailboxId),
      getMailboxHealth(supabase, user.id, mailboxId),
      getReputationProvider().checkMailbox(mailbox.email),
      listAiProviderKeys(supabase, organization.id),
      getLatestRecommendation(supabase, organization.id, "mailbox", mailboxId),
    ]);
  const connectedAiProviders = aiProviderKeys.map((key) => key.provider as AiProviderName);

  const events = emailEvents ?? [];

  // Read-only lookup: mailbox.domain_id is nullable (a mailbox doesn't have
  // to be linked to a tracked domain), so this section degrades to an empty
  // state rather than failing the whole page.
  let domain: Tables<"domains"> | null = null;
  if (mailbox.domain_id) {
    try {
      domain = await getDomain(supabase, user.id, mailbox.domain_id);
    } catch {
      domain = null;
    }
  }

  const [warmupEvents, warmupStats] = warmupProfile
    ? await Promise.all([
        listWarmupEvents(supabase, organization.id, warmupProfile.id),
        listWarmupStats(supabase, organization.id, warmupProfile.id),
      ])
    : [[] as Tables<"warmup_events">[], [] as Tables<"warmup_stats">[]];

  // --- Mailbox Overview (all-time) — reuses lib/analytics/metrics.ts's
  // groupCounts + lib/analytics/mailbox-metrics.ts's summarizeMailboxMetrics,
  // the same shape Campaign Analytics uses.
  const eventCounts = groupCounts(events, (event) => event.event_type);
  const analyticsCounts = groupCounts(analyticsEvents, (event) => event.event_type);

  const overview = summarizeMailboxMetrics({
    sentCount: eventCounts.sent ?? 0,
    deliveredCount: eventCounts.delivered ?? 0,
    openedCount: eventCounts.opened ?? 0,
    clickedCount: eventCounts.clicked ?? 0,
    repliedCount: eventCounts.replied ?? 0,
    bouncedCount: eventCounts.bounced ?? 0,
    spamComplaintCount: analyticsCounts.spam_report ?? 0,
  });

  // --- Timeline + Trends — reuses lib/analytics/aggregations.ts's
  // bucketByDayInRange for both the daily charts and (via total()) the
  // period totals that feed the trend comparison.
  const sentTimestamps = events.filter((e) => e.event_type === "sent").map((e) => e.created_at);
  const deliveredTimestamps = events.filter((e) => e.event_type === "delivered").map((e) => e.created_at);
  const openedTimestamps = events.filter((e) => e.event_type === "opened").map((e) => e.created_at);
  const repliedTimestamps = events.filter((e) => e.event_type === "replied").map((e) => e.created_at);
  const bouncedTimestamps = events.filter((e) => e.event_type === "bounced").map((e) => e.created_at);

  const dailySends = bucketByDayInRange(sentTimestamps, currentRange);
  const dailyOpens = bucketByDayInRange(openedTimestamps, currentRange);
  const dailyReplies = bucketByDayInRange(repliedTimestamps, currentRange);
  const dailyBounces = bucketByDayInRange(bouncedTimestamps, currentRange);
  const dailyDelivered = bucketByDayInRange(deliveredTimestamps, currentRange);

  const sendsTotal = total(dailySends.map((d) => d.value));
  const deliveredTotal = total(dailyDelivered.map((d) => d.value));
  const repliesTotal = total(dailyReplies.map((d) => d.value));
  const bouncesTotal = total(dailyBounces.map((d) => d.value));

  // --- Forecast — reuses lib/analytics/forecasting.ts's LinearTrendForecaster
  // over dailySends, the same series "Daily sends" renders below. Named
  // sendForecast (not forecast) to avoid colliding with the warmup ramp
  // forecast (forecastNextRamp's result) further down this function.
  const sendForecast = await getForecaster().forecast(dailySends, FORECAST_HORIZON_DAYS);
  const sendForecastSummary = summarizeForecast(sendForecast);

  const priorSends = total(bucketByDayInRange(sentTimestamps, priorRange).map((d) => d.value));
  const priorDelivered = total(bucketByDayInRange(deliveredTimestamps, priorRange).map((d) => d.value));
  const priorReplies = total(bucketByDayInRange(repliedTimestamps, priorRange).map((d) => d.value));
  const priorBounces = total(bucketByDayInRange(bouncedTimestamps, priorRange).map((d) => d.value));

  // Warmup progress has no daily-volume time series yet (warmup_stats has
  // no writer — see the migration), so its trend uses the one real signal
  // that does exist: how many warmup_events fired this period vs. the
  // prior one, a genuine (if indirect) measure of warmup momentum.
  const warmupEventsInRange = warmupEvents.filter(
    (e) => e.created_at >= `${currentRange.start}T00:00:00.000Z` && e.created_at <= `${currentRange.end}T23:59:59.999Z`,
  ).length;
  const warmupEventsInPriorRange = warmupEvents.filter(
    (e) => e.created_at >= `${priorRange.start}T00:00:00.000Z` && e.created_at <= `${priorRange.end}T23:59:59.999Z`,
  ).length;

  const trends = compareMetrics(
    { sends: sendsTotal, delivered: deliveredTotal, replies: repliesTotal, bounces: bouncesTotal, warmupActivity: warmupEventsInRange },
    { sends: priorSends, delivered: priorDelivered, replies: priorReplies, bounces: priorBounces, warmupActivity: warmupEventsInPriorRange },
  );

  // --- Warmup Analytics — reuses lib/warmup/scheduler.ts's forecastNextRamp
  // (the same forecast the Warmup Dashboard shows) rather than a second
  // calculation.
  const stage = (warmupProfile?.stage ?? "disabled") as WarmupStage;
  const forecast = warmupProfile
    ? forecastNextRamp({
        stage,
        targetDailyVolume: warmupProfile.target_daily_volume,
        currentDailyVolume: warmupProfile.current_daily_volume,
        rampUpPercent: warmupProfile.ramp_up_percent,
        lastActivityAt: warmupProfile.last_activity_at,
      })
    : { nextVolume: null, nextIncreaseAt: null };
  const warmupProgress = warmupProfile ? rate(warmupProfile.current_daily_volume, warmupProfile.target_daily_volume) : null;

  const warmupHistoryData: DailyCount[] = warmupStats
    .slice()
    .sort((a, b) => a.stat_date.localeCompare(b.stat_date))
    .map((row) => ({ date: row.stat_date, value: row.emails_sent }));

  const warmupTimelineEntries: TimelineEntry[] = warmupEvents.map((event) => ({
    id: event.id,
    source: "warmup_event",
    label: isWarmupEventType(event.event_type) ? WARMUP_EVENT_LABEL[event.event_type] : event.event_type,
    variant: isWarmupEventType(event.event_type) ? WARMUP_EVENT_VARIANT[event.event_type] : "outline",
    detail: event.detail,
    timestamp: event.created_at,
  }));

  // --- AI Insights — deterministic, rule-based (no LLM): reuses the
  // already-computed trends and send forecast. No health-factor insight
  // here — calculateMailboxHealthScore (lib/deliverability/scoring.ts)
  // returns a bare number, not a factor breakdown like the campaign/domain
  // health-score engines, so there's nothing real to adapt yet.
  const aiInsights = collectInsights(
    [
      trendToInsight("sends", "Sending volume", trends.sends),
      trendToInsight("replies", "Replies", trends.replies),
      trendToInsight("bounces", "Bounces", trends.bounces, false),
      forecastToInsight("Sends", sendForecast),
    ],
    "No notable changes for this mailbox right now — everything is steady.",
  );

  const activeRangeLabel = ANALYTICS_RANGE_OPTIONS.find((option) => option.preset === preset)?.label ?? "selected range";

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {mailbox.display_name || mailbox.email}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">Mailbox analytics and performance.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/mailboxes">Back to mailboxes</Link>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div>
          <h2 className="font-semibold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">All-time totals for this mailbox.</p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <MailboxMetricsOverviewCards summary={overview} delayStart={0.08} />
          <FadeIn delay={0.2}>
            <PercentageCard
              title="Spam complaint rate"
              value={overview.spamComplaintRate}
              icon={<AlertTriangleIcon className="size-4" />}
              description="Sourced from the analytics event model — populates once spam complaints are recorded there."
            />
          </FadeIn>
          <FadeIn delay={0.22}>
            <StatCard
              title="Current daily volume"
              value={mailbox.daily_limit}
              icon={<GaugeIcon className="size-4" />}
              description="Configured daily sending limit"
            />
          </FadeIn>
          <FadeIn delay={0.24}>
            <StatCard
              title="Warmup stage"
              value={STAGE_LABEL[stage]}
              icon={<FlameIcon className="size-4" />}
              isEmpty={!warmupProfile}
              emptyHint="Warmup isn't configured for this mailbox."
            />
          </FadeIn>
          <FadeIn delay={0.26}>
            <StatCard
              title="Health score"
              value={`${mailboxHealth?.health_score ?? 0}/100`}
              icon={<ShieldIcon className="size-4" />}
              isEmpty={!mailboxHealth}
              emptyHint="Recalculate mailbox health from the Deliverability page."
            />
          </FadeIn>
          <FadeIn delay={0.28}>
            <StatCard
              title="Reputation score"
              value={mailboxHealth?.reputation_score ?? "—"}
              icon={<BadgeCheckIcon className="size-4" />}
              isEmpty={mailboxHealth?.reputation_score == null}
              emptyHint="Not measured yet — no reputation integration is connected."
            />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.3}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 sm:pt-8">
          <div>
            <h2 className="font-semibold tracking-tight">Timeline</h2>
            <p className="text-sm text-muted-foreground">
              Daily activity and trend vs. the previous {activeRangeLabel.toLowerCase()}.
            </p>
          </div>
          <DateRangePicker
            basePath={`/mailboxes/${mailboxId}/analytics`}
            preset={preset}
            currentRange={currentRange}
            options={ANALYTICS_RANGE_OPTIONS}
          />
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.34}>
          <DailyBarChart title="Daily sends" description="Sends across the selected range." data={dailySends} />
        </FadeIn>
        <FadeIn delay={0.36}>
          <DailyBarChart title="Daily opens" description="Opens across the selected range." data={dailyOpens} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
        <FadeIn delay={0.38}>
          <DailyBarChart title="Daily replies" description="Replies across the selected range." data={dailyReplies} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
        <FadeIn delay={0.4}>
          <DailyBarChart title="Daily bounces" description="Bounces across the selected range." data={dailyBounces} barClassName="bg-destructive" />
        </FadeIn>
      </div>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2">
          <FadeIn delay={0.41}>
            <StatCard
              title={`Projected sends, next ${FORECAST_HORIZON_DAYS} days`}
              value={sendForecastSummary ? sendForecastSummary.projectedTotal : "—"}
              icon={<TrendingUpIcon className="size-4" />}
              isEmpty={!sendForecastSummary}
              emptyHint="Needs at least two days of send history in this range to project a trend."
              description={
                sendForecastSummary
                  ? `${Math.round(sendForecastSummary.averageConfidence * 100)}% average confidence, from the daily sends trend above`
                  : undefined
              }
            />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.42}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Trends</h2>
          <p className="text-sm text-muted-foreground">This {activeRangeLabel.toLowerCase()} vs. the previous one.</p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <FadeIn delay={0.46}>
            <TrendCard title="Sending volume" value={sendsTotal} trend={trends.sends} icon={<SendIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.48}>
            <TrendCard title="Replies" value={repliesTotal} trend={trends.replies} icon={<MessageCircleReplyIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.5}>
            <TrendCard title="Bounces" value={bouncesTotal} trend={trends.bounces} icon={<MailWarningIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.52}>
            <TrendCard title="Deliverability" value={deliveredTotal} trend={trends.delivered} icon={<MailCheckIcon className="size-4" />} description="Delivered count, this range" />
          </FadeIn>
          <FadeIn delay={0.54}>
            <TrendCard
              title="Warmup progress"
              value={warmupEventsInRange}
              trend={trends.warmupActivity}
              icon={<FlameIcon className="size-4" />}
              description="Warmup events recorded, this range"
            />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.55}>
        <InsightsCard
          title="AI Insights"
          description="Deterministic, rule-based callouts from this mailbox's trends and send forecast."
          insights={aiInsights}
        />
      </FadeIn>

      <FadeIn delay={0.56}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Warmup analytics</h2>
          <p className="text-sm text-muted-foreground">Ramp progress and history for this mailbox.</p>
        </div>
      </FadeIn>

      {!warmupProfile ? (
        <FadeIn delay={0.58}>
          <EmptyState
            icon={<FlameIcon className="size-5" />}
            title="Warmup isn't configured for this mailbox"
            description="Enable warmup from the Warmup Dashboard to start tracking ramp progress here."
          />
        </FadeIn>
      ) : (
        <>
          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-4">
              <FadeIn delay={0.58}>
                <StatCard
                  title="Daily volume"
                  value={`${warmupProfile.current_daily_volume}/${warmupProfile.target_daily_volume}`}
                  icon={<GaugeIcon className="size-4" />}
                  description="Current / target per day"
                />
              </FadeIn>
              <FadeIn delay={0.6}>
                <PercentageCard title="Warmup progress" value={warmupProgress} icon={<FlameIcon className="size-4" />} description="Current ÷ target daily volume" />
              </FadeIn>
              <FadeIn delay={0.62}>
                <StatCard
                  title="Next scheduled increase"
                  value={forecast.nextIncreaseAt ? new Date(forecast.nextIncreaseAt).toLocaleDateString() : "—"}
                  icon={<CalendarClockIcon className="size-4" />}
                  isEmpty={!forecast.nextIncreaseAt}
                  description={forecast.nextVolume ? `Ramps to ${forecast.nextVolume}/day` : undefined}
                  emptyHint="No further increases scheduled."
                />
              </FadeIn>
              <FadeIn delay={0.64}>
                <StatusCard
                  title="Warmup status"
                  status={statusLabel(warmupProfile.status)}
                  tone={warmupProfile.status === "enabled" ? "default" : warmupProfile.status === "paused" ? "secondary" : "outline"}
                  icon={<FlameIcon className="size-4" />}
                />
              </FadeIn>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <FadeIn delay={0.68}>
              {warmupHistoryData.length === 0 ? (
                <EmptyState
                  icon={<ActivityIcon className="size-5" />}
                  title="No historical warmup data yet"
                  description="Populates once the stats-aggregation worker starts writing daily warmup numbers."
                />
              ) : (
                <DailyBarChart title="Warmup daily volume" description="Emails sent per day, from recorded warmup stats." data={warmupHistoryData} />
              )}
            </FadeIn>
            <FadeIn delay={0.7}>
              <ActivityTimeline
                entries={warmupTimelineEntries}
                title="Warmup event history"
                description="Status, stage, and volume changes for this mailbox's warmup profile."
                emptyLabel="No warmup events recorded yet."
              />
            </FadeIn>
          </div>
        </>
      )}

      <FadeIn delay={0.72}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Deliverability analytics</h2>
          <p className="text-sm text-muted-foreground">Domain and mailbox health signals.</p>
        </div>
      </FadeIn>

      {!domain ? (
        <FadeIn delay={0.74}>
          <EmptyState
            icon={<ShieldIcon className="size-5" />}
            title="No domain linked to this mailbox"
            description="Link a domain from the Deliverability page to track SPF/DKIM/DMARC status here."
          />
        </FadeIn>
      ) : (
        <DomainDnsStatus domain={domain} delayStart={0.74} />
      )}

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <FadeIn delay={0.84}>
            <StatusCard title="Mailbox verification" status={statusLabel(mailbox.status)} tone={MAILBOX_STATUS_TONE[mailbox.status] ?? "outline"} icon={<MailCheckIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.86}>
            <MailboxHealthSummary mailboxHealth={mailboxHealth} />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.88}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h3 className="text-sm font-semibold tracking-tight text-muted-foreground">Extended signals</h3>
          <p className="text-xs text-muted-foreground">
            Reserved for future integrations — see lib/deliverability/reputation-provider.ts. Not fabricated: every
            value below is a real (currently empty) response from the placeholder provider.
          </p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <FadeIn delay={0.9}>
            <StatusCard title="Inbox placement" status={reputationSignals.inboxPlacementRate == null ? "Not available" : `${reputationSignals.inboxPlacementRate}%`} tone="outline" icon={<MailCheckIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.92}>
            <StatusCard title="Blacklist status" status={reputationSignals.blacklisted == null ? "Not available" : reputationSignals.blacklisted ? "Listed" : "Clear"} tone="outline" icon={<AlertTriangleIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.94}>
            <StatusCard title="Spam test score" status={reputationSignals.spamTestScore == null ? "Not available" : `${reputationSignals.spamTestScore}/100`} tone="outline" icon={<MailWarningIcon className="size-4" />} />
          </FadeIn>
        </div>
      </div>

      <FadeIn delay={0.96}>
        <RecommendationCard
          connectedProviders={connectedAiProviders}
          initialRecommendation={latestRecommendation}
          generateAction={generateMailboxRecommendationAction.bind(null, mailboxId)}
        />
      </FadeIn>
    </div>
  );
}
