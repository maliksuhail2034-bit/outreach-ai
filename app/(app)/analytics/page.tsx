import { Suspense } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  BanIcon,
  EyeIcon,
  MailWarningIcon,
  MessageCircleReplyIcon,
  MousePointerClickIcon,
  SendIcon,
  TrendingUpIcon,
  UsersIcon,
} from "lucide-react";

import { getCachedProfile, getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listCampaigns, listEmailEvents, listSendAttempts } from "@/lib/db";
import { classifyErrorCategory, type ErrorCategory } from "@/lib/analytics/error-category";
import { getForecaster, summarizeForecast } from "@/lib/analytics/forecasting";
import {
  RANGE_PRESETS,
  campaignTotals,
  dailySeries,
  fetchCampaignEventCounts,
  fetchDailyEventCounts,
  previousZonedRange,
  rangeRates,
  resolveZonedRange,
  safeTimezone,
  summarizeEventRows,
  totalsTrends,
  type RangePreset,
} from "@/lib/analytics/range-metrics";
import { calculateTrend } from "@/lib/analytics/trends";
import { FadeIn } from "@/components/motion/fade-in";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendCard } from "@/components/dashboard/trend-card";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { CampaignPerformanceTable, type CampaignPerformanceRow } from "@/components/analytics/campaign-performance-table";
import { FailureAnalysis } from "@/components/analytics/failure-analysis";
import { ActivityTimeline, type TimelineEntry } from "@/components/analytics/activity-timeline";
import { WidgetErrorBoundary } from "@/components/ui/widget-error-boundary";
import { cn } from "@/lib/utils";
import { OrganizationRollupSection, OrganizationRollupSkeleton } from "./_components/organization-rollup-section";

// Failure categorisation and the timeline read recent raw rows; everything
// range-scoped is aggregated in Postgres (lib/analytics/range-metrics.ts).
const FAILURE_SAMPLE_LIMIT = 500;
const TIMELINE_LIMIT = 20;
const FORECAST_HORIZON_DAYS = 7;

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

function parsePreset(value: string | undefined): RangePreset {
  return RANGE_PRESETS.some((option) => option.preset === value) ? (value as RangePreset) : "7d";
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

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
  const [profile, params] = await Promise.all([getCachedProfile(user.id), searchParams]);

  const preset = parsePreset(params.range);
  const timezone = safeTimezone(profile?.timezone);
  const range = resolveZonedRange(preset, timezone);
  const priorRange = previousZonedRange(range);
  const presetLabel = RANGE_PRESETS.find((option) => option.preset === preset)?.label ?? "7 days";
  const rangeLabel = preset === "today" ? "today" : `over the last ${presetLabel}`;

  // Every read here is independent — one round trip of parallel queries.
  const [campaigns, currentCampaignRows, priorCampaignRows, dailyRows, recentAttempts, recentEvents] = await Promise.all([
    listCampaigns(supabase, user.id),
    fetchCampaignEventCounts(supabase, range),
    fetchCampaignEventCounts(supabase, priorRange),
    fetchDailyEventCounts(supabase, range),
    listSendAttempts(supabase, FAILURE_SAMPLE_LIMIT),
    listEmailEvents(supabase, undefined, { limit: TIMELINE_LIMIT }),
  ]);

  const totals = summarizeEventRows(currentCampaignRows);
  const priorTotals = summarizeEventRows(priorCampaignRows);
  const rates = rangeRates(totals);
  const priorRates = rangeRates(priorTotals);
  const trends = totalsTrends(totals, priorTotals);
  const rateTrend = (current: number | null, previous: number | null) => calculateTrend(current ?? 0, previous ?? 0);

  const sentSeries = dailySeries(dailyRows, range, "sent");
  const openSeries = dailySeries(dailyRows, range, "opened");
  const replySeries = dailySeries(dailyRows, range, "replied");
  const failureSeries = dailySeries(dailyRows, range, "failed");

  const sendForecast = await getForecaster().forecast(sentSeries, FORECAST_HORIZON_DAYS);
  const sendForecastSummary = summarizeForecast(sendForecast);

  const byCampaign = campaignTotals(currentCampaignRows);
  const performanceRows: CampaignPerformanceRow[] = (campaigns ?? [])
    .map((campaign) => {
      const campaignRangeTotals = byCampaign.get(campaign.id) ?? summarizeEventRows([]);
      return { campaign, totals: campaignRangeTotals, rates: rangeRates(campaignRangeTotals) };
    })
    // Campaigns with activity in range first, busiest first; idle ones after.
    .sort((a, b) => b.totals.sent - a.totals.sent || b.totals.uniqueReplies - a.totals.uniqueReplies);

  const failureCounts: Record<ErrorCategory, number> = { dns: 0, authentication: 0, tls: 0, timeout: 0, unknown: 0 };
  for (const attempt of recentAttempts ?? []) {
    if (attempt.status !== "failed") continue;
    failureCounts[classifyErrorCategory(attempt.last_error)] += 1;
  }

  const timeline: TimelineEntry[] = [
    ...(recentEvents ?? []).map((event) => ({
      id: event.id,
      source: "email_event" as const,
      label: EMAIL_EVENT_LABEL[event.event_type] ?? event.event_type,
      variant: EMAIL_EVENT_VARIANT[event.event_type] ?? ("outline" as const),
      detail: null,
      timestamp: event.created_at,
    })),
    ...(recentAttempts ?? []).slice(0, TIMELINE_LIMIT).map((attempt) => ({
      id: attempt.id,
      source: "send_attempt" as const,
      label: attempt.status === "sent" ? "Sent" : attempt.status === "failed" ? "Failed" : "Pending",
      variant:
        attempt.status === "sent"
          ? ("default" as const)
          : attempt.status === "failed"
            ? ("destructive" as const)
            : ("secondary" as const),
      detail: attempt.status === "failed" ? attempt.last_error : null,
      timestamp: attempt.resolved_at ?? attempt.claimed_at,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, TIMELINE_LIMIT);

  const vsLabel = `vs. previous ${preset === "today" ? "day" : presetLabel}`;
  const noActivity = totals.sent === 0 && totals.uniqueReplies === 0 && totals.failed === 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Sending and engagement {rangeLabel}, in {timezone}.
            </p>
          </div>
          <nav aria-label="Date range" className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map((option) => {
              const active = option.preset === preset;
              return (
                <Link
                  key={option.preset}
                  href={`/analytics?range=${option.preset}`}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </FadeIn>

      {noActivity && (
        <FadeIn>
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No sends, replies or failures {rangeLabel}. Try a longer range, or{" "}
            <Link href="/campaigns" className="font-medium text-foreground underline underline-offset-2">
              launch a campaign
            </Link>
            .
          </p>
        </FadeIn>
      )}

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @3xl:grid-cols-4">
          <TrendCard title="Emails sent" value={totals.sent} trend={trends.sent} icon={<SendIcon className="size-4" />} description={vsLabel} />
          <TrendCard
            title="Leads contacted"
            value={totals.contacted}
            trend={trends.contacted}
            icon={<UsersIcon className="size-4" />}
            description="Distinct leads emailed"
          />
          <TrendCard
            title="Reply rate"
            value={formatRate(rates.replyRate)}
            trend={rateTrend(rates.replyRate, priorRates.replyRate)}
            icon={<MessageCircleReplyIcon className="size-4" />}
            tone="success"
            description={`${totals.uniqueReplies} leads replied`}
          />
          <TrendCard
            title="Open rate"
            value={formatRate(rates.openRate)}
            trend={rateTrend(rates.openRate, priorRates.openRate)}
            icon={<EyeIcon className="size-4" />}
            description={`${totals.uniqueOpens} leads opened · estimate, see note below`}
          />
          <TrendCard
            title="Click rate"
            value={formatRate(rates.clickRate)}
            trend={rateTrend(rates.clickRate, priorRates.clickRate)}
            icon={<MousePointerClickIcon className="size-4" />}
            description={`${totals.uniqueClicks} leads clicked a link`}
          />
          <TrendCard
            title="Bounce rate"
            value={formatRate(rates.bounceRate)}
            trend={rateTrend(rates.bounceRate, priorRates.bounceRate)}
            goodDirection="down"
            tone="warning"
            icon={<MailWarningIcon className="size-4" />}
            description={`${totals.bounced} bounced · keep under 2%`}
          />
          <TrendCard
            title="Unsubscribes"
            value={totals.unsubscribed}
            trend={trends.unsubscribed}
            goodDirection="down"
            icon={<BanIcon className="size-4" />}
            description={`${formatRate(rates.unsubscribeRate)} of contacted leads`}
          />
          <TrendCard
            title="Failed sends"
            value={totals.failed}
            trend={trends.failed}
            goodDirection="down"
            tone="danger"
            icon={<AlertTriangleIcon className="size-4" />}
            description="Permanently failed after retries"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <DailyBarChart title="Sent per day" description={`Emails sent, ${rangeLabel}.`} data={sentSeries} barClassName="bg-primary" />
        <DailyBarChart title="Replies per day" description={`Replies received, ${rangeLabel}.`} data={replySeries} barClassName="bg-success" />
        <DailyBarChart title="Opens per day" description={`Open events, ${rangeLabel}.`} data={openSeries} />
        <DailyBarChart title="Failures per day" description={`Failed sends, ${rangeLabel}.`} data={failureSeries} barClassName="bg-destructive" />
      </div>

      <p className="text-xs text-muted-foreground">
        Opens are estimates: Apple Mail Privacy Protection and some corporate security scanners load tracking images
        automatically, which inflates opens, while clients that block images hide them. Judge campaigns by replies.
      </p>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2">
          <StatCard
            title={`Projected sends, next ${FORECAST_HORIZON_DAYS} days`}
            value={sendForecastSummary ? sendForecastSummary.projectedTotal : "—"}
            icon={<TrendingUpIcon className="size-4" />}
            isEmpty={!sendForecastSummary}
            emptyHint="Pick a range of at least two days with sends to project a trend."
            description={
              sendForecastSummary
                ? `${Math.round(sendForecastSummary.averageConfidence * 100)}% average confidence, from the sent-per-day trend above`
                : undefined
            }
          />
        </div>
      </div>

      <CampaignPerformanceTable rows={performanceRows} rangeLabel={rangeLabel} />

      <div className="grid gap-6 lg:grid-cols-2">
        <FailureAnalysis counts={failureCounts} />
        <ActivityTimeline entries={timeline} />
      </div>

      <WidgetErrorBoundary label="All-time analytics">
        <Suspense fallback={<OrganizationRollupSkeleton />}>
          <OrganizationRollupSection user={user} sendForecast={sendForecast} />
        </Suspense>
      </WidgetErrorBoundary>
    </div>
  );
}
