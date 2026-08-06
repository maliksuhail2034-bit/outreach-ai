import type { Tables } from "@/types/database.types";
import type { Client, MailboxSafe } from "@/lib/db";
import { getDomain, getOrganizationMembership, listDailyRollups, listMailboxes } from "@/lib/db";
import { summarizeMailboxMetrics, type MailboxMetricsSummary } from "@/lib/analytics/mailbox-metrics";
import { sumByKey } from "@/lib/analytics/metrics";
import { calculateDomainHealthScore, type DomainHealthScoreResult } from "./scoring";

export interface DomainAnalyticsSnapshot {
  domain: Tables<"domains">;
  domainMailboxes: MailboxSafe[];
  // Scalability Track, Phase D: always empty now that overview is sourced
  // from analytics_daily_rollups instead of a raw email_events fetch.
  // Confirmed unused by every real caller (the domain analytics page, the
  // domain compare page, lib/ai/snapshot.ts) before cutting this over — kept
  // in the return shape for now rather than as a Phase D interface change;
  // Phase E is where this field actually gets removed.
  events: Tables<"email_events">[];
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
// (bypassing lib/analytics/domain-metrics.ts's summarizeDomainMetrics,
// which requires raw event rows to do its own counting) rather than
// changing that shared function's signature — it has no other real caller
// today, but leaving it as-is keeps this a pure data-source swap.
export async function loadDomainAnalyticsSnapshot(
  supabase: Client,
  userId: string,
  domainId: string,
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

  return { domain, domainMailboxes, events: [], overview, healthScore };
}
