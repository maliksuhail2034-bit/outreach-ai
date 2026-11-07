import type { FunnelStage } from "@/components/dashboard/funnel-card";
import type { StepEngagementRow } from "@/lib/db/campaign-engagement";
import { identifyBiggestDropOff, type FunnelDropOff } from "./funnel";
import { rate } from "./metrics";

// Per-sequence-step analytics from campaign_engagement()
// (lib/db/campaign-engagement.ts): unique people, bots excluded, over every
// row. Each step is one email per person, so its rates are people who
// opened / clicked / replied out of the people it was sent to. Replies are
// attributed in SQL through the In-Reply-To / References chain; one matched
// by address only isn't attributed to a step.

export interface SequenceStepMetricsInput {
  stepId: string;
  order: number; // 1-based position in the sequence, for "Step N" labeling
  label: string;
}

export interface SequenceStepSummary {
  stepId: string;
  order: number;
  label: string;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  openRate: number | null; // people who opened / sent, this step only
  clickRate: number | null;
  replyRate: number | null;
}

export function summarizeStepEngagement(
  steps: SequenceStepMetricsInput[],
  engagement: StepEngagementRow[],
): SequenceStepSummary[] {
  const byStep = new Map(engagement.map((row) => [row.step_id, row]));
  return steps.map((step) => {
    const row = byStep.get(step.stepId);
    const sentCount = row?.sent ?? 0;
    const openedCount = row?.unique_opened ?? 0;
    const clickedCount = row?.unique_clicked ?? 0;
    const repliedCount = row?.unique_replied ?? 0;
    return {
      stepId: step.stepId,
      order: step.order,
      label: step.label,
      sentCount,
      openedCount,
      clickedCount,
      repliedCount,
      openRate: rate(openedCount, sentCount),
      clickRate: rate(clickedCount, sentCount),
      replyRate: rate(repliedCount, sentCount),
    };
  });
}

// "Best"/"weakest" are reply-rate comparisons — the only per-step metric
// backed by real data today (see SequenceStepSummary above). A step with
// no sends yet (replyRate null) is excluded from both rather than treated
// as a 0% floor or ceiling.
export function identifyBestStep(summaries: SequenceStepSummary[]): SequenceStepSummary | null {
  const withReplyRate = summaries.filter(
    (summary): summary is SequenceStepSummary & { replyRate: number } => summary.replyRate !== null,
  );
  if (withReplyRate.length === 0) return null;
  return withReplyRate.reduce((best, current) => (current.replyRate > best.replyRate ? current : best));
}

export function identifyWeakestStep(summaries: SequenceStepSummary[]): SequenceStepSummary | null {
  const withReplyRate = summaries.filter(
    (summary): summary is SequenceStepSummary & { replyRate: number } => summary.replyRate !== null,
  );
  if (withReplyRate.length === 0) return null;
  return withReplyRate.reduce((weakest, current) => (current.replyRate < weakest.replyRate ? current : weakest));
}

// Step-to-step attrition (how many leads who received step N never
// received step N+1) is the exact same shape as a funnel drop-off, so this
// reuses lib/analytics/funnel.ts's identifyBiggestDropOff directly instead
// of a second drop-off algorithm — sentCount-per-step, in step order,
// stands in for FunnelStage.value.
export function identifyBiggestStepDropOff(summaries: SequenceStepSummary[]): FunnelDropOff | null {
  const stages: FunnelStage[] = summaries
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((summary) => ({ key: summary.stepId, label: summary.label, value: summary.sentCount }));

  return identifyBiggestDropOff(stages);
}
