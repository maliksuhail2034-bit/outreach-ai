import type { Client } from "@/lib/db";
import { listCampaigns, listDomains, listEmailEvents, listMailboxes } from "@/lib/db";
import { loadCampaignAnalyticsSnapshot, type CampaignAnalyticsSnapshot } from "@/lib/campaigns/campaign-analytics";
import { loadMailboxAnalyticsSnapshot, type MailboxAnalyticsSnapshot } from "@/lib/mailboxes/mailbox-analytics";
import { loadDomainAnalyticsSnapshot, type DomainAnalyticsSnapshot } from "@/lib/deliverability/domain-analytics";
import { calculatePeerAverage, compareToBenchmark } from "./benchmarks";
import type { ForecastPoint } from "./forecasting";
import { benchmarkToInsight, collectInsights, forecastToInsight, type Insight } from "./insights";
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
  const [campaigns, mailboxes, domains] = await Promise.all([
    listCampaigns(supabase, userId),
    listMailboxes(supabase, userId),
    listDomains(supabase, userId),
  ]);

  // Explicitly scoped to this organization's own mailboxes (already
  // user_id-filtered above), rather than an unfiltered fetch that only
  // stayed correct because the caller happened to be using the RLS-scoped
  // client. This is what makes loadOrganizationRollup safe to call with the
  // admin client too (see lib/integrations/digest.ts) — without this, an
  // admin-context caller would pull every organization's events into this
  // one organization's overview.
  const orgEvents = await listEmailEvents(supabase, undefined, {
    mailboxIds: (mailboxes ?? []).map((mailbox) => mailbox.id),
    limit: ORG_EVENT_FETCH_LIMIT,
  });

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

export interface OrganizationBenchmarks {
  campaignReplyRatePeerAverage: Record<string, number>;
  mailboxReplyRatePeerAverage: Record<string, number>;
  domainReplyRatePeerAverage: Record<string, number>;
}

// Reuses lib/analytics/benchmarks.ts's calculatePeerAverage over the
// snapshots loadOrganizationRollup already fetched — one peer average per
// entity type, computed once and shared by both the /analytics page's
// rollup-table benchmark column and buildOrganizationInsights below, so
// neither recomputes it a second time.
export function calculateOrganizationBenchmarks(rollup: OrganizationRollup): OrganizationBenchmarks {
  return {
    campaignReplyRatePeerAverage: calculatePeerAverage(
      rollup.campaignSnapshots.map((snapshot) => ({ replyRate: snapshot.overview.replyRate })),
    ),
    mailboxReplyRatePeerAverage: calculatePeerAverage(
      rollup.mailboxSnapshots.map((snapshot) => ({ replyRate: snapshot.overview.replyRate })),
    ),
    domainReplyRatePeerAverage: calculatePeerAverage(
      rollup.domainSnapshots.map((snapshot) => ({ replyRate: snapshot.overview.replyRate })),
    ),
  };
}

// Deterministic, rule-based AI Insights for the organization as a whole —
// one benchmark callout per campaign/mailbox/domain that's significantly
// off its own peer-group average, plus the organization's own send
// forecast trajectory. Shared by the /analytics page (which also renders
// the underlying benchmark numbers in its rollup tables) and
// lib/integrations/digest.ts's organization digest, so this composition
// exists in exactly one place instead of two.
export function buildOrganizationInsights(
  rollup: OrganizationRollup,
  benchmarks: OrganizationBenchmarks,
  sendForecast: ForecastPoint[],
): Insight[] {
  const campaignInsights = rollup.campaignSnapshots.map((snapshot) => {
    const benchmark = compareToBenchmark(
      { replyRate: snapshot.overview.replyRate },
      benchmarks.campaignReplyRatePeerAverage,
    ).replyRate;
    return benchmark ? benchmarkToInsight(snapshot.campaign.name, "reply rate", benchmark) : null;
  });

  const mailboxInsights = rollup.mailboxSnapshots.map((snapshot) => {
    const benchmark = compareToBenchmark(
      { replyRate: snapshot.overview.replyRate },
      benchmarks.mailboxReplyRatePeerAverage,
    ).replyRate;
    const label = snapshot.mailbox.display_name || snapshot.mailbox.email;
    return benchmark ? benchmarkToInsight(label, "reply rate", benchmark) : null;
  });

  const domainInsights = rollup.domainSnapshots.map((snapshot) => {
    const benchmark = compareToBenchmark(
      { replyRate: snapshot.overview.replyRate },
      benchmarks.domainReplyRatePeerAverage,
    ).replyRate;
    return benchmark ? benchmarkToInsight(snapshot.domain.domain, "reply rate", benchmark) : null;
  });

  return collectInsights(
    [...campaignInsights, ...mailboxInsights, ...domainInsights, forecastToInsight("Sending volume", sendForecast)],
    "No notable changes across your organization right now — everything is steady.",
  );
}
