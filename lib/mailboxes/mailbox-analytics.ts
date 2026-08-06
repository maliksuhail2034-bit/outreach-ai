import type { Tables } from "@/types/database.types";
import type { Client, MailboxSafe } from "@/lib/db";
import { getMailboxHealth, listAnalyticsEvents, listDailyRollups } from "@/lib/db";
import { summarizeMailboxMetrics, type MailboxMetricsSummary } from "@/lib/analytics/mailbox-metrics";
import { groupCounts, sumByKey } from "@/lib/analytics/metrics";

// Single-mailbox scope — analytics_events (unlike email_events) has no
// rollup pipeline yet, so this fetch stays as-is; comfortably covers a
// mailbox's full history without pagination.
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
//
// Scalability Track, Phase D: overview counts now come from
// analytics_daily_rollups (pre-aggregated by lib/analytics/rollup-worker.ts)
// instead of fetching every raw email_events row for this mailbox and
// grouping in JS — nothing else in this function needs the raw rows (unlike
// lib/campaigns/campaign-analytics.ts, which still needs them for its
// step-drop-off computation and hasn't been cut over for that reason).
export async function loadMailboxAnalyticsSnapshot(
  supabase: Client,
  organizationId: string,
  mailbox: MailboxSafe,
): Promise<MailboxAnalyticsSnapshot> {
  const [rollups, analyticsEvents, health] = await Promise.all([
    listDailyRollups(supabase, organizationId, { subjectType: "mailbox", subjectId: mailbox.id }),
    listAnalyticsEvents(supabase, organizationId, {
      subjectType: "mailbox",
      subjectId: mailbox.id,
      limit: EVENT_FETCH_LIMIT,
    }),
    getMailboxHealth(supabase, mailbox.user_id, mailbox.id),
  ]);

  const eventCounts = sumByKey(
    rollups,
    (row) => row.event_type,
    (row) => row.event_count,
  );
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
