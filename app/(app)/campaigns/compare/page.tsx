import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRightIcon, EyeIcon, MailCheckIcon, MailWarningIcon, MessageCircleReplyIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db";
import {
  getCampaign,
  getOrCreateOrganizationForUser,
  listAnalyticsEvents,
  listCampaignLeads,
  listCampaigns,
  listEmailEvents,
  listSendAttemptsForCampaignLeads,
  listSequences,
  listSequenceSteps,
} from "@/lib/db";
import {
  compareCampaignMetrics,
  summarizeCampaignMetrics,
  type CampaignMetricsSummary,
} from "@/lib/analytics/campaign-metrics";
import { groupCounts } from "@/lib/analytics/metrics";
import {
  identifyBiggestStepDropOff,
  summarizeSequenceSteps,
  type SequenceStepMetricsInput,
} from "@/lib/analytics/sequence-step-metrics";
import { calculateCampaignHealthScore, type CampaignHealthScoreResult } from "@/lib/campaigns/health-score";
import { campaignCompareQuerySchema } from "@/lib/validations/campaigns";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PercentageCard } from "@/components/dashboard/percentage-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CampaignHealthCard } from "@/components/campaigns/campaign-health-card";
import { CampaignComparisonTable, type ComparisonMetricRow } from "@/components/campaigns/campaign-comparison-table";

// Single-campaign scope per side, so this matches the campaign analytics
// page's own limit — a comparison is two of those overviews side by side.
const EVENT_FETCH_LIMIT = 5000;

const SELECT_CLASSNAME =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface CampaignSnapshot {
  campaign: Tables<"campaigns">;
  overview: CampaignMetricsSummary;
  healthScore: CampaignHealthScoreResult;
}

// Fetches and summarizes one campaign's all-time data — the same
// Overview/Health-score computation the campaign analytics page does
// (lib/analytics/campaign-metrics.ts's summarizeCampaignMetrics,
// lib/campaigns/health-score.ts's calculateCampaignHealthScore), just
// without the date-ranged Trends section this page doesn't need. Calls
// calculateCampaignHealthScore directly — no wrapper around its scoring
// logic. engagementTrend is passed null here (not computed) because a
// comparison is a snapshot across two campaigns, not a period-over-period
// view of one; deliveryRate/positiveReplyRate/meetingRate are null for the
// same "no real producer yet" reason the campaign analytics page documents.
async function loadCampaignSnapshot(
  supabase: Client,
  organizationId: string,
  campaign: Tables<"campaigns">,
): Promise<CampaignSnapshot> {
  const [campaignLeads, emailEvents, analyticsEvents] = await Promise.all([
    listCampaignLeads(supabase, campaign.id),
    listEmailEvents(supabase, campaign.id, { limit: EVENT_FETCH_LIMIT }),
    listAnalyticsEvents(supabase, organizationId, {
      subjectType: "campaign",
      subjectId: campaign.id,
      limit: EVENT_FETCH_LIMIT,
    }),
  ]);

  const leadIds = (campaignLeads ?? []).map((row) => row.id);
  const [sendAttemptsResult, sequences] = await Promise.all([
    listSendAttemptsForCampaignLeads(supabase, leadIds),
    listSequences(supabase, campaign.id),
  ]);
  const sendAttempts = sendAttemptsResult ?? [];
  const events = emailEvents ?? [];
  const sentAttempts = sendAttempts.filter((attempt) => attempt.status === "sent");

  const sequence = sequences?.[0] ?? null;
  const sequenceSteps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];

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

  const stepInputs: SequenceStepMetricsInput[] = (sequenceSteps ?? []).map((step, index) => ({
    stepId: step.id,
    order: index + 1,
    label: step.subject || `Step ${index + 1}`,
  }));
  const stepSummaries = summarizeSequenceSteps(stepInputs, sendAttempts, events);
  const biggestStepDropOff = identifyBiggestStepDropOff(stepSummaries);

  const healthScore = calculateCampaignHealthScore({
    bounceRate: overview.bounceRate,
    replyRate: overview.replyRate,
    deliveryRate: null,
    positiveReplyRate: null,
    meetingRate: null,
    engagementTrend: null,
    biggestStepDropOff,
  });

  return { campaign, overview, healthScore };
}

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
    <form className="rounded-xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm" action="/campaigns/compare" method="get">
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

  const namePrefix = user.email?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);

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
    loadCampaignSnapshot(supabase, organization.id, campaignA),
    loadCampaignSnapshot(supabase, organization.id, campaignB),
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
        <CampaignComparisonTable campaignAName={campaignA.name} campaignBName={campaignB.name} rows={comparisonRows} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Campaign health</h2>
          <p className="text-sm text-muted-foreground">Each campaign&apos;s health score, computed independently.</p>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.35}>
          <CampaignHealthCard score={snapshotA.healthScore.score} factors={snapshotA.healthScore.factors} />
        </FadeIn>
        <FadeIn delay={0.4}>
          <CampaignHealthCard score={snapshotB.healthScore.score} factors={snapshotB.healthScore.factors} />
        </FadeIn>
      </div>
    </div>
  );
}
