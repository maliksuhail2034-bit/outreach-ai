import Link from "next/link";
import { notFound } from "next/navigation";
import { InboxIcon, MessageCircleReplyIcon, SendIcon, MailCheckIcon, MailWarningIcon, TrendingUpIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { bucketByDayInRange, previousDateRange, resolveDateRange } from "@/lib/analytics/aggregations";
import { compareMetrics } from "@/lib/analytics/comparisons";
import { getForecaster, summarizeForecast } from "@/lib/analytics/forecasting";
import { total } from "@/lib/analytics/metrics";
import { ANALYTICS_RANGE_OPTIONS, type DateRangePreset } from "@/lib/analytics/types";
import { dateRangeQuerySchema } from "@/lib/validations/analytics";
import { loadDomainAnalyticsSnapshot, type DomainAnalyticsSnapshot } from "@/lib/deliverability/domain-analytics";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendCard } from "@/components/dashboard/trend-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { HealthScoreCard } from "@/components/analytics/health-score-card";
import { ScoreBadge } from "@/components/deliverability/score-badge";
import { DomainDnsStatus } from "@/components/deliverability/domain-dns-status";

const FORECAST_HORIZON_DAYS = 7;

export default async function DomainAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ domainId: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
}) {
  const { domainId } = await params;
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  // Fetch orchestration (domain lookup, mailbox resolution, combined event
  // fetch, overview summary, health score) is shared with Domain Comparison
  // via lib/deliverability/domain-analytics.ts — this page only adds the
  // date-ranged trend bucketing below, which Domain Comparison doesn't need.
  let snapshot: DomainAnalyticsSnapshot;
  try {
    snapshot = await loadDomainAnalyticsSnapshot(supabase, user.id, domainId);
  } catch {
    notFound();
  }
  const { domain, domainMailboxes, events, overview, healthScore } = snapshot;

  const query = await searchParams;
  const parsedQuery = dateRangeQuerySchema.safeParse({ preset: query.range ?? "7d", start: query.start, end: query.end });
  const preset: DateRangePreset = parsedQuery.success ? parsedQuery.data.preset : "7d";
  const currentRange =
    preset === "custom" && parsedQuery.success && parsedQuery.data.start && parsedQuery.data.end
      ? resolveDateRange("custom", { start: parsedQuery.data.start, end: parsedQuery.data.end })
      : resolveDateRange(preset === "custom" ? "7d" : preset);
  const priorRange = previousDateRange(currentRange);

  const activeRangeLabel = ANALYTICS_RANGE_OPTIONS.find((option) => option.preset === preset)?.label ?? "selected range";

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{domain.domain}</h1>
              <ScoreBadge score={domain.health_score} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">Domain analytics and performance.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/deliverability">Back to deliverability</Link>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div>
          <h2 className="font-semibold tracking-tight">Domain health</h2>
          <p className="text-sm text-muted-foreground">
            DNS verification, plus deliverability, bounce rate, and reply rate where this domain has real sending
            history.
          </p>
        </div>
      </FadeIn>

      <DomainDnsStatus domain={domain} delayStart={0.08} />

      <FadeIn delay={0.18}>
        <HealthScoreCard
          title="Domain health score"
          description="Weighted from DNS verification and, once available, this domain's real deliverability signals."
          emptyTitle="Not enough data yet"
          emptyDescription="A health score appears once this domain has DNS verification results."
          score={healthScore.score}
          factors={healthScore.factors}
        />
      </FadeIn>

      {domainMailboxes.length === 0 ? (
        <FadeIn delay={0.2}>
          <EmptyState
            icon={<InboxIcon className="size-5" />}
            title="No mailboxes linked to this domain"
            description="Assign a mailbox to this domain from the Deliverability page to start tracking its combined sending performance here."
          />
        </FadeIn>
      ) : (
        <>
          <FadeIn delay={0.2}>
            <div>
              <h2 className="font-semibold tracking-tight">Overview</h2>
              <p className="text-sm text-muted-foreground">
                All-time totals across every mailbox linked to this domain.
              </p>
            </div>
          </FadeIn>

          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
              <MailboxMetricsOverviewCards summary={overview} delayStart={0.23} />
              <FadeIn delay={0.33}>
                <StatCard
                  title="Mailboxes"
                  value={domainMailboxes.length}
                  icon={<InboxIcon className="size-4" />}
                  description="Mailboxes sending from this domain"
                />
              </FadeIn>
            </div>
          </div>

          <FadeIn delay={0.35}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 sm:pt-8">
              <div>
                <h2 className="font-semibold tracking-tight">Trends</h2>
                <p className="text-sm text-muted-foreground">
                  Daily activity and trend vs. the previous {activeRangeLabel.toLowerCase()}.
                </p>
              </div>
              <DateRangePicker
                basePath={`/settings/deliverability/${domainId}/analytics`}
                preset={preset}
                currentRange={currentRange}
                options={ANALYTICS_RANGE_OPTIONS}
              />
            </div>
          </FadeIn>

          <TrendsSection events={events} currentRange={currentRange} priorRange={priorRange} />
        </>
      )}
    </div>
  );
}

async function TrendsSection({
  events,
  currentRange,
  priorRange,
}: {
  events: { event_type: string; created_at: string }[];
  currentRange: { start: string; end: string };
  priorRange: { start: string; end: string };
}) {
  const sentTimestamps = events.filter((e) => e.event_type === "sent").map((e) => e.created_at);
  const deliveredTimestamps = events.filter((e) => e.event_type === "delivered").map((e) => e.created_at);
  const openedTimestamps = events.filter((e) => e.event_type === "opened").map((e) => e.created_at);
  const repliedTimestamps = events.filter((e) => e.event_type === "replied").map((e) => e.created_at);
  const bouncedTimestamps = events.filter((e) => e.event_type === "bounced").map((e) => e.created_at);

  const dailySends = bucketByDayInRange(sentTimestamps, currentRange);
  const dailyOpens = bucketByDayInRange(openedTimestamps, currentRange);
  const dailyReplies = bucketByDayInRange(repliedTimestamps, currentRange);
  const dailyBounces = bucketByDayInRange(bouncedTimestamps, currentRange);

  // Reuses lib/analytics/forecasting.ts's LinearTrendForecaster over
  // dailySends, the same series "Daily sends" renders below — no extra
  // query beyond what this section already computes.
  const sendForecast = await getForecaster().forecast(dailySends, FORECAST_HORIZON_DAYS);
  const sendForecastSummary = summarizeForecast(sendForecast);

  const sendsTotal = total(dailySends.map((d) => d.value));
  const deliveredTotal = total(bucketByDayInRange(deliveredTimestamps, currentRange).map((d) => d.value));
  const repliesTotal = total(dailyReplies.map((d) => d.value));
  const bouncesTotal = total(dailyBounces.map((d) => d.value));

  const priorSends = total(bucketByDayInRange(sentTimestamps, priorRange).map((d) => d.value));
  const priorDelivered = total(bucketByDayInRange(deliveredTimestamps, priorRange).map((d) => d.value));
  const priorReplies = total(bucketByDayInRange(repliedTimestamps, priorRange).map((d) => d.value));
  const priorBounces = total(bucketByDayInRange(bouncedTimestamps, priorRange).map((d) => d.value));

  const trends = compareMetrics(
    { sends: sendsTotal, delivered: deliveredTotal, replies: repliesTotal, bounces: bouncesTotal },
    { sends: priorSends, delivered: priorDelivered, replies: priorReplies, bounces: priorBounces },
  );

  return (
    <>
      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-4">
          <FadeIn delay={0.4}>
            <TrendCard title="Sending volume" value={sendsTotal} trend={trends.sends} icon={<SendIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.42}>
            <TrendCard title="Replies" value={repliesTotal} trend={trends.replies} icon={<MessageCircleReplyIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.44}>
            <TrendCard title="Bounces" value={bouncesTotal} trend={trends.bounces} icon={<MailWarningIcon className="size-4" />} />
          </FadeIn>
          <FadeIn delay={0.46}>
            <TrendCard title="Deliverability" value={deliveredTotal} trend={trends.delivered} icon={<MailCheckIcon className="size-4" />} description="Delivered count, this range" />
          </FadeIn>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.5}>
          <DailyBarChart title="Daily sends" description="Sends across the selected range." data={dailySends} />
        </FadeIn>
        <FadeIn delay={0.52}>
          <DailyBarChart title="Daily opens" description="Opens across the selected range." data={dailyOpens} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
        <FadeIn delay={0.54}>
          <DailyBarChart title="Daily replies" description="Replies across the selected range." data={dailyReplies} barClassName="bg-secondary-foreground/70" />
        </FadeIn>
        <FadeIn delay={0.56}>
          <DailyBarChart title="Daily bounces" description="Bounces across the selected range." data={dailyBounces} barClassName="bg-destructive" />
        </FadeIn>
      </div>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2">
          <FadeIn delay={0.58}>
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
    </>
  );
}
