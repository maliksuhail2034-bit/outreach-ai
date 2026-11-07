import type { Tables } from "@/types/database.types";
import type { Client } from "@/lib/db";
import { getCampaignEngagement, listAnalyticsEvents, listSequences, listSequenceSteps } from "@/lib/db";
import { summarizeCampaignMetrics, type CampaignMetricsSummary } from "@/lib/analytics/campaign-metrics";
import { groupCounts } from "@/lib/analytics/metrics";
import {
  identifyBiggestStepDropOff,
  summarizeStepEngagement,
  type SequenceStepMetricsInput,
} from "@/lib/analytics/sequence-step-metrics";
import { calculateCampaignHealthScore, type CampaignHealthScoreResult } from "./health-score";

const ANALYTICS_EVENT_FETCH_LIMIT = 5000;

export interface CampaignAnalyticsSnapshot {
  campaign: Tables<"campaigns">;
  overview: CampaignMetricsSummary;
  healthScore: CampaignHealthScoreResult;
}

// Fetches and summarizes one campaign's all-time data — the same
// Overview/Health-score computation the campaign analytics page does
// (lib/analytics/campaign-metrics.ts's summarizeCampaignMetrics,
// lib/campaigns/health-score.ts's calculateCampaignHealthScore), just
// without the date-ranged Trends section that page adds on top. Shared by
// Campaign Comparison and the /analytics organization rollup so neither
// duplicates this orchestration. engagementTrend is always passed null here
// (not computed) because this is a snapshot, not a period-over-period view
// of one campaign; deliveryRate/positiveReplyRate/meetingRate are null for
// the same "no real producer yet" reason the campaign analytics page
// documents.
export async function loadCampaignAnalyticsSnapshot(
  supabase: Client,
  organizationId: string,
  campaign: Tables<"campaigns">,
): Promise<CampaignAnalyticsSnapshot> {
  // Engagement is unique people with bots excluded, over every row
  // (campaign_engagement()); emails sent is the send log.
  const [engagement, analyticsEvents, sequences] = await Promise.all([
    getCampaignEngagement(supabase, campaign.id),
    listAnalyticsEvents(supabase, organizationId, {
      subjectType: "campaign",
      subjectId: campaign.id,
      limit: ANALYTICS_EVENT_FETCH_LIMIT,
    }),
    listSequences(supabase, campaign.id),
  ]);

  const sequence = sequences?.[0] ?? null;
  const sequenceSteps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];
  const analyticsCounts = groupCounts(analyticsEvents, (event) => event.event_type);

  const overview = summarizeCampaignMetrics({
    sentCount: engagement.emails_sent,
    contactedCount: engagement.leads_contacted,
    // No delivery confirmations exist for SMTP/Gmail/Graph sending.
    deliveredCount: 0,
    openedCount: engagement.unique_opened,
    clickedCount: engagement.unique_clicked,
    repliedCount: engagement.unique_replied,
    bouncedCount: engagement.unique_bounced,
    positiveReplyCount: analyticsCounts.positive_reply ?? 0,
    meetingBookedCount: analyticsCounts.meeting_booked ?? 0,
  });

  const stepInputs: SequenceStepMetricsInput[] = [...(sequenceSteps ?? [])]
    .sort((a, b) => a.step_order - b.step_order)
    .map((step, index) => ({ stepId: step.id, order: index + 1, label: step.subject || `Step ${index + 1}` }));
  const biggestStepDropOff = identifyBiggestStepDropOff(summarizeStepEngagement(stepInputs, engagement.steps));

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
