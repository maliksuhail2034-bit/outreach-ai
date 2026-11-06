import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getLatestRecommendation, getUserOrganization, listAiProviderKeys } from "@/lib/db";
import type { AiProviderName } from "@/lib/ai/get-provider";
import { compareToBenchmark } from "@/lib/analytics/benchmarks";
import type { ForecastPoint } from "@/lib/analytics/forecasting";
import {
  buildOrganizationInsights,
  calculateOrganizationBenchmarks,
  loadOrganizationRollup,
} from "@/lib/analytics/organization-rollup";
import { FadeIn } from "@/components/motion/fade-in";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightsCard } from "@/components/analytics/insights-card";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { RollupTable, type RollupRow } from "@/components/analytics/rollup-table";
import { RecommendationCard } from "@/components/ai/recommendation-card";
import { generateOrganizationRecommendationAction } from "../actions";

// All-time, per-entity rollup + insights + AI recommendation. This is the
// expensive part of /analytics (one snapshot load per campaign, mailbox and
// domain), so the page streams it in behind <Suspense> instead of making the
// range metrics above wait for it.
export async function OrganizationRollupSection({ user, sendForecast }: { user: User; sendForecast: ForecastPoint[] }) {
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const [rollup, aiProviderKeys, latestRecommendation] = await Promise.all([
    loadOrganizationRollup(supabase, user.id, organization.id),
    listAiProviderKeys(supabase, organization.id),
    getLatestRecommendation(supabase, organization.id, "organization", null),
  ]);
  const connectedAiProviders = aiProviderKeys.map((key) => key.provider as AiProviderName);

  const benchmarks = calculateOrganizationBenchmarks(rollup);

  const campaignRollupRows: RollupRow[] = rollup.campaignSnapshots.map((snapshot) => ({
    key: snapshot.campaign.id,
    label: snapshot.campaign.name,
    href: `/campaigns/${snapshot.campaign.id}/analytics`,
    sentCount: snapshot.overview.sentCount,
    replyRate: snapshot.overview.replyRate,
    bounceRate: snapshot.overview.bounceRate,
    healthScore: snapshot.healthScore.score,
    replyRateBenchmark:
      compareToBenchmark({ replyRate: snapshot.overview.replyRate }, benchmarks.campaignReplyRatePeerAverage).replyRate ?? null,
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
      compareToBenchmark({ replyRate: snapshot.overview.replyRate }, benchmarks.mailboxReplyRatePeerAverage).replyRate ?? null,
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
      compareToBenchmark({ replyRate: snapshot.overview.replyRate }, benchmarks.domainReplyRatePeerAverage).replyRate ?? null,
  }));

  const insights = buildOrganizationInsights(rollup, benchmarks, sendForecast);

  return (
    <>
      <FadeIn>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="text-xl font-semibold tracking-tight">All-time by campaign, mailbox and domain</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Lifetime totals, each benchmarked against its own peer-group average reply rate. Organization totals are
            rolled up nightly, so today&apos;s activity appears tomorrow — use the range above for live numbers.
          </p>
        </div>
      </FadeIn>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          <MailboxMetricsOverviewCards summary={rollup.overview} />
        </div>
      </div>

      <FadeIn>
        <RollupTable
          title="Campaigns"
          description="Every campaign's all-time sent volume, reply rate, bounce rate, and health score."
          emptyLabel="No campaigns yet."
          rows={campaignRollupRows}
        />
      </FadeIn>

      <div className="grid gap-6 xl:grid-cols-2">
        <FadeIn>
          <RollupTable
            title="Mailboxes"
            description="Every mailbox's all-time sent volume, reply rate, bounce rate, and health score."
            emptyLabel="No mailboxes yet."
            rows={mailboxRollupRows}
          />
        </FadeIn>
        <FadeIn>
          <RollupTable
            title="Domains"
            description="Every domain's all-time sent volume, reply rate, bounce rate, and health score."
            emptyLabel="No domains yet."
            rows={domainRollupRows}
          />
        </FadeIn>
      </div>

      <FadeIn>
        <InsightsCard
          title="Insights"
          description="Rule-based callouts from the reply-rate benchmarks above and your send forecast."
          insights={insights}
        />
      </FadeIn>

      <FadeIn>
        <RecommendationCard
          connectedProviders={connectedAiProviders}
          initialRecommendation={latestRecommendation}
          generateAction={generateOrganizationRecommendationAction}
        />
      </FadeIn>
    </>
  );
}

export function OrganizationRollupSkeleton() {
  return (
    <div className="space-y-6 border-t border-border pt-6 sm:pt-8" aria-busy="true" aria-label="Loading all-time analytics">
      <Skeleton className="h-6 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
