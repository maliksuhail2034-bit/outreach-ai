import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRightIcon, EyeIcon, MailCheckIcon, MailWarningIcon, MessageCircleReplyIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getCampaign, getUserOrganization, listCampaigns } from "@/lib/db";
import { compareCampaignMetrics } from "@/lib/analytics/campaign-metrics";
import { loadCampaignAnalyticsSnapshot } from "@/lib/campaigns/campaign-analytics";
import { campaignCompareQuerySchema } from "@/lib/validations/campaigns";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PercentageCard } from "@/components/dashboard/percentage-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { HealthScoreCard } from "@/components/analytics/health-score-card";
import { ComparisonTable, type ComparisonMetricRow } from "@/components/analytics/comparison-table";

const SELECT_CLASSNAME =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function CampaignPicker({
  campaigns,
  selectedA,
  selectedB,
}: {
  campaigns: Tables<"campaigns">[];
  selectedA?: string;
  selectedB?: string;
}) {
  if (campaigns.length < 2) {
    return (
      <EmptyState
        icon={<ArrowLeftRightIcon className="size-5" />}
        title="Need at least two campaigns to compare"
        description="Create another campaign to compare performance side by side."
      />
    );
  }

  return (
    <form className="rounded-xl border border-border bg-card p-5 shadow-sm" action="/campaigns/compare" method="get">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="a">Campaign A</Label>
          <select id="a" name="a" defaultValue={selectedA ?? ""} className={SELECT_CLASSNAME} required>
            <option value="" disabled>
              Choose a campaign
            </option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b">Campaign B</Label>
          <select id="b" name="b" defaultValue={selectedB ?? ""} className={SELECT_CLASSNAME} required>
            <option value="" disabled>
              Choose a campaign
            </option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Compare</Button>
      </div>
    </form>
  );
}

export default async function CampaignComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const campaigns = await listCampaigns(supabase, user.id);
  const campaignList = campaigns ?? [];

  const query = await searchParams;
  const parsedQuery = campaignCompareQuerySchema.safeParse(query);
  const requestedA = parsedQuery.success ? parsedQuery.data.a : undefined;
  const requestedB = parsedQuery.success ? parsedQuery.data.b : undefined;
  const readyToCompare = Boolean(requestedA && requestedB && requestedA !== requestedB);

  if (!readyToCompare) {
    return (
      <div className="space-y-6 sm:space-y-8">
        <FadeIn>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Pick two campaigns to compare their performance side by side.
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={0.05}>
          <CampaignPicker campaigns={campaignList} selectedA={requestedA} selectedB={requestedB} />
        </FadeIn>
      </div>
    );
  }

  const organization = await getUserOrganization(supabase, user);

  let campaignA: Tables<"campaigns">;
  let campaignB: Tables<"campaigns">;
  try {
    [campaignA, campaignB] = await Promise.all([
      getCampaign(supabase, user.id, requestedA as string),
      getCampaign(supabase, user.id, requestedB as string),
    ]);
  } catch {
    notFound();
  }

  const [snapshotA, snapshotB] = await Promise.all([
    loadCampaignAnalyticsSnapshot(supabase, organization.id, campaignA),
    loadCampaignAnalyticsSnapshot(supabase, organization.id, campaignB),
  ]);

  // The one call this whole page exists to finally make — see
  // ROADMAP.md's "In progress" section, which calls out compareCampaignMetrics
  // as a seam with no caller yet.
  const metricTrends = compareCampaignMetrics(snapshotA.overview, snapshotB.overview);

  const comparisonRows: ComparisonMetricRow[] = [
    { key: "sent", label: "Emails sent", format: "count", aValue: snapshotA.overview.sentCount, bValue: snapshotB.overview.sentCount, trend: metricTrends.sent },
    { key: "delivered", label: "Delivered", format: "count", aValue: snapshotA.overview.deliveredCount, bValue: snapshotB.overview.deliveredCount, trend: metricTrends.delivered },
    { key: "opened", label: "Opened", format: "count", aValue: snapshotA.overview.openedCount, bValue: snapshotB.overview.openedCount, trend: metricTrends.opened },
    { key: "clicked", label: "Clicked", format: "count", aValue: snapshotA.overview.clickedCount, bValue: snapshotB.overview.clickedCount, trend: metricTrends.clicked },
    { key: "replied", label: "Replied", format: "count", aValue: snapshotA.overview.repliedCount, bValue: snapshotB.overview.repliedCount, trend: metricTrends.replied },
    { key: "bounced", label: "Bounced", format: "count", aValue: snapshotA.overview.bouncedCount, bValue: snapshotB.overview.bouncedCount, trend: metricTrends.bounced },
    { key: "positiveReply", label: "Positive replies", format: "count", aValue: snapshotA.overview.positiveReplyCount, bValue: snapshotB.overview.positiveReplyCount, trend: metricTrends.positiveReply },
    { key: "meetingBooked", label: "Meetings booked", format: "count", aValue: snapshotA.overview.meetingBookedCount, bValue: snapshotB.overview.meetingBookedCount, trend: metricTrends.meetingBooked },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {campaignA.name} vs. {campaignB.name}, all-time.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/campaigns/compare">Change campaigns</Link>
          </Button>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        {[{ label: campaignA.name, overview: snapshotA.overview }, { label: campaignB.name, overview: snapshotB.overview }].map(
          ({ label, overview }) => (
            <FadeIn key={label} delay={0.1}>
              <div>
                <h2 className="font-semibold tracking-tight">{label}</h2>
                <div className="@container mt-3">
                  <div className="grid gap-4 @sm:grid-cols-2">
                    <PercentageCard title="Delivery rate" value={overview.deliveryRate} icon={<MailCheckIcon className="size-4" />} description="Delivered ÷ sent" />
                    <PercentageCard title="Open rate" value={overview.openRate} icon={<EyeIcon className="size-4" />} description="Opened ÷ delivered" />
                    <PercentageCard title="Reply rate" value={overview.replyRate} icon={<MessageCircleReplyIcon className="size-4" />} description="Replied ÷ sent" />
                    <PercentageCard title="Bounce rate" value={overview.bounceRate} icon={<MailWarningIcon className="size-4" />} description="Bounced ÷ sent" />
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
        <ComparisonTable aLabel={campaignA.name} bLabel={campaignB.name} rows={comparisonRows} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Campaign health</h2>
          <p className="text-sm text-muted-foreground">Each campaign&apos;s health score, computed independently.</p>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.35}>
          <HealthScoreCard
            title="Campaign health"
            description="Weighted from every signal with real data today."
            emptyTitle="Not enough data yet"
            emptyDescription="A health score appears once this campaign has real bounce/reply data, an engagement trend, or step performance to measure."
            score={snapshotA.healthScore.score}
            factors={snapshotA.healthScore.factors}
          />
        </FadeIn>
        <FadeIn delay={0.4}>
          <HealthScoreCard
            title="Campaign health"
            description="Weighted from every signal with real data today."
            emptyTitle="Not enough data yet"
            emptyDescription="A health score appears once this campaign has real bounce/reply data, an engagement trend, or step performance to measure."
            score={snapshotB.healthScore.score}
            factors={snapshotB.healthScore.factors}
          />
        </FadeIn>
      </div>
    </div>
  );
}
