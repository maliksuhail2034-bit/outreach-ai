import type { Tables } from "@/types/database.types";
import type { Client } from "@/lib/db";
import {
  listAnalyticsEvents,
  listCampaignLeads,
  listEmailEvents,
  listSendAttemptsForCampaignLeads,
  listSequences,
  listSequenceSteps,
} from "@/lib/db";
import { summarizeCampaignMetrics, type CampaignMetricsSummary } from "@/lib/analytics/campaign-metrics";
import { groupCounts } from "@/lib/analytics/metrics";
import {
  identifyBiggestStepDropOff,
  summarizeSequenceSteps,
  type SequenceStepMetricsInput,
} from "@/lib/analytics/sequence-step-metrics";
import { calculateCampaignHealthScore, type CampaignHealthScoreResult } from "./health-score";

// Single-campaign scope, so this matches the campaign analytics page's own
// limit — comfortably covers a campaign's full history without pagination.
const EVENT_FETCH_LIMIT = 5000;

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
