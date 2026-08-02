import type { Tables } from "@/types/database.types";
import type { Client, MailboxSafe } from "@/lib/db";
import { getMailboxHealth, listAnalyticsEvents, listEmailEvents } from "@/lib/db";
import { summarizeMailboxMetrics, type MailboxMetricsSummary } from "@/lib/analytics/mailbox-metrics";
import { groupCounts } from "@/lib/analytics/metrics";

// Single-mailbox scope, so this matches the mailbox analytics page's own
// limit — comfortably covers a mailbox's full history without pagination.
const EVENT_FETCH_LIMIT = 5000;

export interface MailboxAnalyticsSnapshot {
  mailbox: MailboxSafe;
  overview: MailboxMetricsSummary;
  health: Tables<"mailbox_health"> | null;
}

// Fetches and summarizes one mailbox's all-time data — the same Overview
// computation the mailbox analytics page does
// (lib/analytics/mailbox-metrics.ts's summarizeMailboxMetrics), plus its
// stored health row (mailbox_health, written by calculateMailboxHealthScore
// in settings/deliverability/actions.ts — not recomputed here). Shared by
// Mailbox Comparison and the /analytics organization rollup so neither
// duplicates this orchestration.
export async function loadMailboxAnalyticsSnapshot(
  supabase: Client,
  organizationId: string,
  mailbox: MailboxSafe,
): Promise<MailboxAnalyticsSnapshot> {
  const [emailEvents, analyticsEvents, health] = await Promise.all([
    listEmailEvents(supabase, undefined, { mailboxId: mailbox.id, limit: EVENT_FETCH_LIMIT }),
    listAnalyticsEvents(supabase, organizationId, {
      subjectType: "mailbox",
      subjectId: mailbox.id,
      limit: EVENT_FETCH_LIMIT,
    }),
    getMailboxHealth(supabase, mailbox.user_id, mailbox.id),
  ]);

  const events = emailEvents ?? [];
  const eventCounts = groupCounts(events, (event) => event.event_type);
  const analyticsCounts = groupCounts(analyticsEvents, (event) => event.event_type);

  const overview = summarizeMailboxMetrics({
    sentCount: eventCounts.sent ?? 0,
    deliveredCount: eventCounts.delivered ?? 0,
    openedCount: eventCounts.opened ?? 0,
    clickedCount: eventCounts.clicked ?? 0,
    repliedCount: eventCounts.replied ?? 0,
    bouncedCount: eventCounts.bounced ?? 0,
    spamComplaintCount: analyticsCounts.spam_report ?? 0,
  });

  return { mailbox, overview, health };
}
