import { compareMetrics } from "./comparisons";
import { rate } from "./metrics";
import type { TrendResult } from "./trends";

// Mailbox-scoped metrics — the numbers Mailbox Analytics needs, built on
// lib/analytics' existing primitives (rate, compareMetrics), the same shape
// campaign-metrics.ts uses for campaigns. Counts come from email_events
// (mailbox_id-scoped — real data, see lib/db/email-events.ts's mailboxId
// filter) for the operational metrics and from analytics_events
// (subject_type='mailbox' — mostly empty today, see the Analytics
// Foundation) for spamComplaintCount; this module doesn't care which table
// a count came from, only the number itself.
export interface MailboxMetricsInputs {
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  spamComplaintCount: number;
}

export interface MailboxMetricsSummary extends MailboxMetricsInputs {
  deliveryRate: number | null; // delivered / sent
  openRate: number | null; // opened / delivered
  clickRate: number | null; // clicked / delivered
  replyRate: number | null; // replied / sent
  bounceRate: number | null; // bounced / sent
  spamComplaintRate: number | null; // spam complaints / sent
}

export function summarizeMailboxMetrics(inputs: MailboxMetricsInputs): MailboxMetricsSummary {
  return {
    ...inputs,
    deliveryRate: rate(inputs.deliveredCount, inputs.sentCount),
    openRate: rate(inputs.openedCount, inputs.deliveredCount),
    clickRate: rate(inputs.clickedCount, inputs.deliveredCount),
    replyRate: rate(inputs.repliedCount, inputs.sentCount),
    bounceRate: rate(inputs.bouncedCount, inputs.sentCount),
    spamComplaintRate: rate(inputs.spamComplaintCount, inputs.sentCount),
  };
}

// Reusable comparison service, the same "prepare architecture for
// comparing X" shape as compareCampaignMetrics: no UI calls this with two
// different mailboxes yet — the Mailbox Analytics page only ever
// summarizes one mailbox at a time — but a future "compare mailboxes" view
// gets a ready-made TrendResult per metric just by calling this with two
// summarizeMailboxMetrics() results.
export function compareMailboxMetrics(
  current: MailboxMetricsSummary,
  previous: MailboxMetricsSummary,
): Record<string, TrendResult> {
  return compareMetrics(
    {
      sent: current.sentCount,
      delivered: current.deliveredCount,
      opened: current.openedCount,
      clicked: current.clickedCount,
      replied: current.repliedCount,
      bounced: current.bouncedCount,
      spamComplaint: current.spamComplaintCount,
    },
    {
      sent: previous.sentCount,
      delivered: previous.deliveredCount,
      opened: previous.openedCount,
      clicked: previous.clickedCount,
      replied: previous.repliedCount,
      bounced: previous.bouncedCount,
      spamComplaint: previous.spamComplaintCount,
    },
  );
}
