import { summarizeMailboxMetrics, type MailboxMetricsSummary } from "./mailbox-metrics";
import { groupCounts } from "./metrics";

// A domain's activity is simply the combined activity of every mailbox
// linked to it (mailboxes.domain_id) — this reuses
// lib/analytics/mailbox-metrics.ts's summarizeMailboxMetrics directly for
// the actual rate math (the exact engine Mailbox Analytics already uses)
// rather than a parallel implementation. The only genuinely domain-specific
// step is grouping event counts across however many mailboxes belong to a
// domain before handing them to that engine — callers should already have
// scoped `events` to just this domain's mailboxes (e.g. via
// listEmailEvents's mailboxIds filter).
//
// Trend comparison has no domain-specific version here on purpose: two
// DomainMetricsSummary-shaped (== MailboxMetricsSummary-shaped) objects
// compare with lib/analytics/mailbox-metrics.ts's compareMailboxMetrics
// directly — wrapping it would just be a same-signature re-export.

export interface EmailEventForDomainMetrics {
  event_type: string;
}

export function summarizeDomainMetrics(events: EmailEventForDomainMetrics[]): MailboxMetricsSummary {
  const eventCounts = groupCounts(events, (event) => event.event_type);

  return summarizeMailboxMetrics({
    sentCount: eventCounts.sent ?? 0,
    deliveredCount: eventCounts.delivered ?? 0,
    openedCount: eventCounts.opened ?? 0,
    clickedCount: eventCounts.clicked ?? 0,
    repliedCount: eventCounts.replied ?? 0,
    bouncedCount: eventCounts.bounced ?? 0,
    // No per-domain spam-complaint data source exists yet (same limitation
    // mailbox-metrics.ts documents for analytics_events) — 0 is an honest
    // "none recorded" count, not a fabricated rate.
    spamComplaintCount: 0,
  });
}
