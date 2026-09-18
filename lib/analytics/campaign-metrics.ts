import { compareMetrics } from "./comparisons";
import { rate } from "./metrics";
import type { TrendResult } from "./trends";

// Campaign-scoped metrics — the numbers Campaign Overview/Comparison need,
// built entirely on lib/analytics' existing primitives (rate, compareMetrics)
// rather than a new calculation style. Counts come from email_events/
// send_attempts (real data) for the operational metrics and from
// analytics_events (see the Analytics Foundation — mostly empty today) for
// positiveReplyCount/meetingBookedCount; this module doesn't care which
// table a count came from, only the number itself.
export interface CampaignMetricsInputs {
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  positiveReplyCount: number;
  meetingBookedCount: number;
}

export interface CampaignMetricsSummary extends CampaignMetricsInputs {
  deliveryRate: number | null; // delivered / sent
  // Batch 9C: denominator is sentCount, not deliveredCount. There is no
  // 'delivered' email_event producer anywhere in this codebase (no ESP
  // delivery-webhook infrastructure for SMTP/Gmail/Graph sending) and
  // building one is explicitly out of scope — opened/clicked/sent, unlike
  // delivered, all have real producers, so sentCount is the only
  // denominator that lets these ever be a real, non-null percentage. See
  // lib/analytics/metrics.ts's rate() — still null, not a fabricated 0%,
  // when sentCount is 0.
  openRate: number | null; // opened / sent
  clickRate: number | null; // clicked / sent
  bounceRate: number | null; // bounced / sent
  replyRate: number | null; // replied / sent
}

export function summarizeCampaignMetrics(inputs: CampaignMetricsInputs): CampaignMetricsSummary {
  return {
    ...inputs,
    deliveryRate: rate(inputs.deliveredCount, inputs.sentCount),
    openRate: rate(inputs.openedCount, inputs.sentCount),
    clickRate: rate(inputs.clickedCount, inputs.sentCount),
    bounceRate: rate(inputs.bouncedCount, inputs.sentCount),
    replyRate: rate(inputs.repliedCount, inputs.sentCount),
  };
}

// Reusable comparison service (Phase 2B's "prepare architecture for
// comparing campaigns" requirement): compares two campaigns' already-
// summarized metrics, reusing the same trend engine every other comparison
// in this app uses. No UI calls this with two different campaigns yet —
// the Campaign Analytics page only ever summarizes one campaign at a time,
// using compareMetrics directly for its own period-over-period trends —
// but a future "compare campaigns" view gets a ready-made TrendResult per
// metric (the same shape ComparisonCard already renders) just by calling
// this with two summarizeCampaignMetrics() results.
export function compareCampaignMetrics(
  current: CampaignMetricsSummary,
  previous: CampaignMetricsSummary,
): Record<string, TrendResult> {
  return compareMetrics(
    {
      sent: current.sentCount,
      delivered: current.deliveredCount,
      opened: current.openedCount,
      clicked: current.clickedCount,
      replied: current.repliedCount,
      bounced: current.bouncedCount,
      positiveReply: current.positiveReplyCount,
      meetingBooked: current.meetingBookedCount,
    },
    {
      sent: previous.sentCount,
      delivered: previous.deliveredCount,
      opened: previous.openedCount,
      clicked: previous.clickedCount,
      replied: previous.repliedCount,
      bounced: previous.bouncedCount,
      positiveReply: previous.positiveReplyCount,
      meetingBooked: previous.meetingBookedCount,
    },
  );
}
