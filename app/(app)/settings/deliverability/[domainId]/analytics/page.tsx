import Link from "next/link";
import { notFound } from "next/navigation";
import { InboxIcon, MessageCircleReplyIcon, SendIcon, MailCheckIcon, MailWarningIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getDomain, listEmailEvents, listMailboxes } from "@/lib/db";
import { bucketByDayInRange, previousDateRange, resolveDateRange } from "@/lib/analytics/aggregations";
import { compareMetrics } from "@/lib/analytics/comparisons";
import { summarizeDomainMetrics } from "@/lib/analytics/domain-metrics";
import { total } from "@/lib/analytics/metrics";
import { ANALYTICS_RANGE_OPTIONS, type DateRangePreset } from "@/lib/analytics/types";
import { dateRangeQuerySchema } from "@/lib/validations/analytics";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrendCard } from "@/components/dashboard/trend-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { ScoreBadge } from "@/components/deliverability/score-badge";
import { DomainDnsStatus } from "@/components/deliverability/domain-dns-status";

// Single-domain scope, so a generous limit (like the campaign/mailbox
// analytics pages') comfortably covers a domain's full combined history
// without pagination.
const EVENT_FETCH_LIMIT = 5000;

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

  let domain;
  try {
    domain = await getDomain(supabase, user.id, domainId);
  } catch {
    notFound();
  }

  const query = await searchParams;
  const parsedQuery = dateRangeQuerySchema.safeParse({ preset: query.range ?? "7d", start: query.start, end: query.end });
  const preset: DateRangePreset = parsedQuery.success ? parsedQuery.data.preset : "7d";
  const currentRange =
    preset === "custom" && parsedQuery.success && parsedQuery.data.start && parsedQuery.data.end
      ? resolveDateRange("custom", { start: parsedQuery.data.start, end: parsedQuery.data.end })
      : resolveDateRange(preset === "custom" ? "7d" : preset);
  const priorRange = previousDateRange(currentRange);

  // A domain has no direct link to email_events — only mailboxes.domain_id
  // does — so this filters the user's full mailbox list down to the ones
  // linked to this domain, then fetches their combined events in one query
  // (listEmailEvents's mailboxIds filter) instead of one call per mailbox.
  const allMailboxes = await listMailboxes(supabase, user.id);
  const domainMailboxes = allMailboxes.filter((mailbox) => mailbox.domain_id === domainId);
  const mailboxIds = domainMailboxes.map((mailbox) => mailbox.id);

  const events =
    mailboxIds.length > 0 ? ((await listEmailEvents(supabase, undefined, { mailboxIds, limit: EVENT_FETCH_LIMIT })) ?? []) : [];

  // --- Overview (all-time) — reuses lib/analytics/domain-metrics.ts's
  // summarizeDomainMetrics, which itself calls
  // lib/analytics/mailbox-metrics.ts's summarizeMailboxMetrics directly —
  // the same rate-calculation engine Mailbox Analytics uses, just fed this
  // domain's combined mailbox event counts instead of one mailbox's.
  const overview = summarizeDomainMetrics(events);

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
          <p className="text-sm text-muted-foreground">DNS verification status for this domain.</p>
        </div>
      </FadeIn>

      <DomainDnsStatus domain={domain} delayStart={0.08} />

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

function TrendsSection({
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
    </>
  );
}
