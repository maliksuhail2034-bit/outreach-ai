import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRightIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/db";
import { compareMailboxMetrics } from "@/lib/analytics/mailbox-metrics";
import { loadDomainAnalyticsSnapshot, type DomainAnalyticsSnapshot } from "@/lib/deliverability/domain-analytics";
import { domainCompareQuerySchema } from "@/lib/validations/deliverability";
import type { Tables } from "@/types/database.types";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { ComparisonTable, type ComparisonMetricRow } from "@/components/analytics/comparison-table";
import { HealthScoreCard } from "@/components/analytics/health-score-card";

const SELECT_CLASSNAME =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function DomainPicker({
  domains,
  selectedA,
  selectedB,
}: {
  domains: Tables<"domains">[];
  selectedA?: string;
  selectedB?: string;
}) {
  if (domains.length < 2) {
    return (
      <EmptyState
        icon={<ArrowLeftRightIcon className="size-5" />}
        title="Need at least two domains to compare"
        description="Add another domain to compare performance side by side."
      />
    );
  }

  return (
    <form
      className="rounded-xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm"
      action="/settings/deliverability/compare"
      method="get"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="a">Domain A</Label>
          <select id="a" name="a" defaultValue={selectedA ?? ""} className={SELECT_CLASSNAME} required>
            <option value="" disabled>
              Choose a domain
            </option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.domain}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b">Domain B</Label>
          <select id="b" name="b" defaultValue={selectedB ?? ""} className={SELECT_CLASSNAME} required>
            <option value="" disabled>
              Choose a domain
            </option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.domain}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Compare</Button>
      </div>
    </form>
  );
}

export default async function DomainComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const domains = await listDomains(supabase, user.id);
  const domainList = domains ?? [];

  const query = await searchParams;
  const parsedQuery = domainCompareQuerySchema.safeParse(query);
  const requestedA = parsedQuery.success ? parsedQuery.data.a : undefined;
  const requestedB = parsedQuery.success ? parsedQuery.data.b : undefined;
  const readyToCompare = Boolean(requestedA && requestedB && requestedA !== requestedB);

  if (!readyToCompare) {
    return (
      <div className="space-y-6 sm:space-y-8">
        <FadeIn>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare domains</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Pick two domains to compare their performance side by side.
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={0.05}>
          <DomainPicker domains={domainList} selectedA={requestedA} selectedB={requestedB} />
        </FadeIn>
      </div>
    );
  }

  // Fetch orchestration (domain lookup, mailbox resolution, combined event
  // fetch, overview summary, health score) is the exact same
  // loadDomainAnalyticsSnapshot the single-domain analytics page uses —
  // this page doesn't duplicate any of it, only the A-vs-B presentation.
  let snapshotA: DomainAnalyticsSnapshot;
  let snapshotB: DomainAnalyticsSnapshot;
  try {
    [snapshotA, snapshotB] = await Promise.all([
      loadDomainAnalyticsSnapshot(supabase, user.id, requestedA as string),
      loadDomainAnalyticsSnapshot(supabase, user.id, requestedB as string),
    ]);
  } catch {
    notFound();
  }

  // The one call this whole page exists to finally make for domains —
  // domain overviews are MailboxMetricsSummary-shaped (same as mailboxes),
  // so two of them compare with compareMailboxMetrics directly, no wrapper
  // needed.
  const metricTrends = compareMailboxMetrics(snapshotA.overview, snapshotB.overview);

  const comparisonRows: ComparisonMetricRow[] = [
    { key: "sent", label: "Emails sent", format: "count", aValue: snapshotA.overview.sentCount, bValue: snapshotB.overview.sentCount, trend: metricTrends.sent },
    { key: "delivered", label: "Delivered", format: "count", aValue: snapshotA.overview.deliveredCount, bValue: snapshotB.overview.deliveredCount, trend: metricTrends.delivered },
    { key: "opened", label: "Opened", format: "count", aValue: snapshotA.overview.openedCount, bValue: snapshotB.overview.openedCount, trend: metricTrends.opened },
    { key: "clicked", label: "Clicked", format: "count", aValue: snapshotA.overview.clickedCount, bValue: snapshotB.overview.clickedCount, trend: metricTrends.clicked },
    { key: "replied", label: "Replied", format: "count", aValue: snapshotA.overview.repliedCount, bValue: snapshotB.overview.repliedCount, trend: metricTrends.replied },
    { key: "bounced", label: "Bounced", format: "count", aValue: snapshotA.overview.bouncedCount, bValue: snapshotB.overview.bouncedCount, trend: metricTrends.bounced },
  ];

  const labelA = snapshotA.domain.domain;
  const labelB = snapshotB.domain.domain;

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare domains</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {labelA} vs. {labelB}, all-time.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/deliverability/compare">Change domains</Link>
          </Button>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        {[{ label: labelA, overview: snapshotA.overview }, { label: labelB, overview: snapshotB.overview }].map(
          ({ label, overview }) => (
            <FadeIn key={label} delay={0.1}>
              <div>
                <h2 className="font-semibold tracking-tight">{label}</h2>
                <div className="@container mt-3">
                  <div className="grid gap-4 @sm:grid-cols-2">
                    <MailboxMetricsOverviewCards summary={overview} delayStart={0.12} />
                  </div>
                </div>
              </div>
            </FadeIn>
          ),
        )}
      </div>

      <FadeIn delay={0.2}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Metrics</h2>
          <p className="text-sm text-muted-foreground">Every overview metric, A vs. B.</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.25}>
        <ComparisonTable aLabel={labelA} bLabel={labelB} rows={comparisonRows} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Domain health</h2>
          <p className="text-sm text-muted-foreground">Each domain&apos;s health score, computed independently.</p>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.35}>
          <HealthScoreCard
            title={labelA}
            description="Weighted from DNS verification and, once available, this domain's real deliverability signals."
            emptyTitle="Not enough data yet"
            emptyDescription="A health score appears once this domain has DNS verification results."
            score={snapshotA.healthScore.score}
            factors={snapshotA.healthScore.factors}
          />
        </FadeIn>
        <FadeIn delay={0.4}>
          <HealthScoreCard
            title={labelB}
            description="Weighted from DNS verification and, once available, this domain's real deliverability signals."
            emptyTitle="Not enough data yet"
            emptyDescription="A health score appears once this domain has DNS verification results."
            score={snapshotB.healthScore.score}
            factors={snapshotB.healthScore.factors}
          />
        </FadeIn>
      </div>
    </div>
  );
}
