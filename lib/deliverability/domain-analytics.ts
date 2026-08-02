import type { Tables } from "@/types/database.types";
import type { Client, MailboxSafe } from "@/lib/db";
import { getDomain, listEmailEvents, listMailboxes } from "@/lib/db";
import { summarizeDomainMetrics } from "@/lib/analytics/domain-metrics";
import type { MailboxMetricsSummary } from "@/lib/analytics/mailbox-metrics";
import { calculateDomainHealthScore, type DomainHealthScoreResult } from "./scoring";

// Single-domain scope, so a generous limit (like the campaign/mailbox
// analytics pages') comfortably covers a domain's full combined history
// without pagination.
const EVENT_FETCH_LIMIT = 5000;

export interface DomainAnalyticsSnapshot {
  domain: Tables<"domains">;
  domainMailboxes: MailboxSafe[];
  events: Tables<"email_events">[];
  overview: MailboxMetricsSummary;
  healthScore: DomainHealthScoreResult;
}

// The fetch-and-summarize orchestration one domain's analytics needs: look
// up the domain (throws if not owned — callers should catch and notFound(),
// same as getDomain everywhere else), resolve which mailboxes send from it
// (a domain has no direct link to email_events — only mailboxes.domain_id
// does), fetch their combined events in one query, then run the same
// summarizeDomainMetrics/calculateDomainHealthScore engines the Domain
// Analytics page already uses. Shared by that page and Domain Comparison so
// neither duplicates this orchestration — only date-ranged trend bucketing
// (which Domain Comparison doesn't need, same as Mailbox Comparison) stays
// page-local.
export async function loadDomainAnalyticsSnapshot(
  supabase: Client,
  userId: string,
  domainId: string,
): Promise<DomainAnalyticsSnapshot> {
  const domain = await getDomain(supabase, userId, domainId);

  const allMailboxes = await listMailboxes(supabase, userId);
  const domainMailboxes = allMailboxes.filter((mailbox) => mailbox.domain_id === domainId);
  const mailboxIds = domainMailboxes.map((mailbox) => mailbox.id);

  const events =
    mailboxIds.length > 0
      ? ((await listEmailEvents(supabase, undefined, { mailboxIds, limit: EVENT_FETCH_LIMIT })) ?? [])
      : [];

  const overview = summarizeDomainMetrics(events);

  const healthScore = calculateDomainHealthScore({
    spfVerified: domain.spf_verified,
    dkimVerified: domain.dkim_verified,
    dmarcVerified: domain.dmarc_verified,
    mxVerified: domain.mx_verified,
    deliveryRate: overview.deliveryRate,
    bounceRate: overview.bounceRate,
    replyRate: overview.replyRate,
  });

  return { domain, domainMailboxes, events, overview, healthScore };
}
