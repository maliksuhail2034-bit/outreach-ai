import type { Tables } from "@/types/database.types";
import type { Client, MailboxSafe } from "@/lib/db";
import { getDomain, getOrganizationMembership, listDailyRollups, listMailboxes } from "@/lib/db";
import { summarizeMailboxMetrics, type MailboxMetricsSummary } from "@/lib/analytics/mailbox-metrics";
import { sumByKey } from "@/lib/analytics/metrics";
import type { DateRange } from "@/lib/analytics/types";
import { calculateDomainHealthScore, type DomainHealthScoreResult } from "./scoring";

export interface DomainAnalyticsSnapshot {
  domain: Tables<"domains">;
  domainMailboxes: MailboxSafe[];
  // Production Readiness, Deliverability Trends Rollup Migration: one row
  // per (rollup_date, event_type) for this domain (subject_type='domain'),
  // already written nightly by lib/analytics/rollup-worker.ts's
  // upsertDomainRollups. Scoped to whatever range the caller passes as
  // trendsRange; empty when no range is given (Domain Comparison only
  // needs overview, not trend data). Replaces the old
  // events: Tables<"email_events">[] field, which Scalability Track Phase D
  // left permanently empty once the overview computation below moved to
  // rollups — Phase E's cleanup found it was still consumed by the Trends
  // section and deferred its replacement here rather than just deleting it.
  dailyRollups: Tables<"analytics_daily_rollups">[];
  overview: MailboxMetricsSummary;
  healthScore: DomainHealthScoreResult;
}

// The fetch-and-summarize orchestration one domain's analytics needs: look
// up the domain (throws if not owned — callers should catch and notFound(),
// same as getDomain everywhere else), resolve which mailboxes send from it
// (a domain has no direct link to email_events — only mailboxes.domain_id
// does), sum their pre-aggregated rollup counts, then run the same
// calculateDomainHealthScore engine the Domain Analytics page already uses.
// Shared by that page and Domain Comparison so neither duplicates this
// orchestration — only date-ranged trend bucketing (which Domain Comparison
// doesn't need, same as Mailbox Comparison) stays page-local.
//
// Scalability Track, Phase D: overview counts now come from
// analytics_daily_rollups (pre-aggregated by lib/analytics/rollup-worker.ts)
// instead of fetching every raw email_events row across the domain's
// mailboxes and grouping in JS. Calls summarizeMailboxMetrics directly
// rather than changing that shared function's signature, keeping this a
// pure data-source swap. (lib/analytics/domain-metrics.ts's
// summarizeDomainMetrics, the raw-event-counting equivalent this bypassed,
// was removed in Phase E once this was confirmed as its last real caller.)
export async function loadDomainAnalyticsSnapshot(
  supabase: Client,
  userId: string,
  domainId: string,
  trendsRange?: DateRange,
): Promise<DomainAnalyticsSnapshot> {
  const domain = await getDomain(supabase, userId, domainId);

  const allMailboxes = await listMailboxes(supabase, userId);
  const domainMailboxes = allMailboxes.filter((mailbox) => mailbox.domain_id === domainId);
  const mailboxIds = domainMailboxes.map((mailbox) => mailbox.id);

  const membership = mailboxIds.length > 0 ? await getOrganizationMembership(supabase, userId) : null;
  const rollups =
    membership && mailboxIds.length > 0
      ? await listDailyRollups(supabase, membership.organization_id, { subjectType: "mailbox", subjectIds: mailboxIds })
      : [];

  const eventCounts = sumByKey(
    rollups,
    (row) => row.event_type,
    (row) => row.event_count,
  );
  const overview = summarizeMailboxMetrics({
    sentCount: eventCounts.sent ?? 0,
    deliveredCount: eventCounts.delivered ?? 0,
    openedCount: eventCounts.opened ?? 0,
    clickedCount: eventCounts.clicked ?? 0,
    repliedCount: eventCounts.replied ?? 0,
    bouncedCount: eventCounts.bounced ?? 0,
    // No per-domain spam-complaint data source exists yet — same
    // limitation the pre-cutover code already documented.
    spamComplaintCount: 0,
  });

  const healthScore = calculateDomainHealthScore({
    spfVerified: domain.spf_verified,
    dkimVerified: domain.dkim_verified,
    dmarcVerified: domain.dmarc_verified,
    mxVerified: domain.mx_verified,
    deliveryRate: overview.deliveryRate,
    bounceRate: overview.bounceRate,
    replyRate: overview.replyRate,
  });

  // Only fetched when a caller passes a range — the domain analytics page
  // does (for its Trends section); Domain Comparison doesn't.
  const dailyRollups =
    membership && trendsRange
      ? await listDailyRollups(supabase, membership.organization_id, {
          subjectType: "domain",
          subjectId: domainId,
          since: trendsRange.start,
          until: trendsRange.end,
        })
      : [];

  return { domain, domainMailboxes, dailyRollups, overview, healthScore };
}
