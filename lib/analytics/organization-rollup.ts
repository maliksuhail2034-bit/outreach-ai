import type { Client } from "@/lib/db";
import { listCampaigns, listDomains, listEmailEvents, listMailboxes } from "@/lib/db";
import { loadCampaignAnalyticsSnapshot, type CampaignAnalyticsSnapshot } from "@/lib/campaigns/campaign-analytics";
import { loadMailboxAnalyticsSnapshot, type MailboxAnalyticsSnapshot } from "@/lib/mailboxes/mailbox-analytics";
import { loadDomainAnalyticsSnapshot, type DomainAnalyticsSnapshot } from "@/lib/deliverability/domain-analytics";
import { summarizeMailboxMetrics, type MailboxMetricsSummary } from "./mailbox-metrics";
import { groupCounts } from "./metrics";

// Separate, higher limit than the /analytics page's existing 500-row
// send_attempts/email_events fetch (ANALYTICS_ROW_LIMIT) — that cap exists
// for that section's charts/timeline, not for a rollup total that claims to
// represent the whole organization, so this uses the same 5000 every
// per-entity analytics page already uses rather than silently undercounting
// past 500 events.
const ORG_EVENT_FETCH_LIMIT = 5000;

export interface OrganizationRollup {
  overview: MailboxMetricsSummary;
  campaignSnapshots: CampaignAnalyticsSnapshot[];
  mailboxSnapshots: MailboxAnalyticsSnapshot[];
  domainSnapshots: DomainAnalyticsSnapshot[];
}

// Isolated orchestration boundary for the /analytics page's organization
// rollup section — the page calls only loadOrganizationRollup() and renders
// whatever it returns; it never loops over
// listCampaigns/listMailboxes/listDomains itself. Today this fans out one
// snapshot fetch per campaign/mailbox/domain (N+1) by calling each entity's
// existing loadXAnalyticsSnapshot (already shared with that entity's own
// Compare page) in parallel — acceptable at today's scale, since nothing in
// this codebase paginates these lists yet. Isolating the fan-out here means
// a future batched/bulk-query implementation, or a read from
// analytics_daily_rollups once that pipeline exists (see
// lib/db/analytics.ts — architecture only today, no writer), can replace
// the body of this one function without any UI caller changing.
export async function loadOrganizationRollup(
  supabase: Client,
  userId: string,
  organizationId: string,
): Promise<OrganizationRollup> {
  const [campaigns, mailboxes, domains, orgEvents] = await Promise.all([
    listCampaigns(supabase, userId),
    listMailboxes(supabase, userId),
    listDomains(supabase, userId),
    listEmailEvents(supabase, undefined, { limit: ORG_EVENT_FETCH_LIMIT }),
  ]);

  const [campaignSnapshots, mailboxSnapshots, domainSnapshots] = await Promise.all([
    Promise.all(
      (campaigns ?? []).map((campaign) => loadCampaignAnalyticsSnapshot(supabase, organizationId, campaign)),
    ),
    Promise.all(
      (mailboxes ?? []).map((mailbox) => loadMailboxAnalyticsSnapshot(supabase, organizationId, mailbox)),
    ),
    Promise.all((domains ?? []).map((domain) => loadDomainAnalyticsSnapshot(supabase, userId, domain.id))),
  ]);

  const eventCounts = groupCounts(orgEvents ?? [], (event) => event.event_type);
  const overview = summarizeMailboxMetrics({
    sentCount: eventCounts.sent ?? 0,
    deliveredCount: eventCounts.delivered ?? 0,
    openedCount: eventCounts.opened ?? 0,
    clickedCount: eventCounts.clicked ?? 0,
    repliedCount: eventCounts.replied ?? 0,
    bouncedCount: eventCounts.bounced ?? 0,
    // No org-wide spam-complaint data source exists yet — same limitation
    // lib/analytics/domain-metrics.ts documents for a single domain.
    spamComplaintCount: 0,
  });

  return { overview, campaignSnapshots, mailboxSnapshots, domainSnapshots };
}
