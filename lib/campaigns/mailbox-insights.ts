import { resolveLeadMailboxId } from "./readiness";
import type { Insight, InsightTone } from "@/lib/analytics/insights";
import { summarizeMailboxMetrics } from "@/lib/analytics/mailbox-metrics";
import { groupCounts } from "@/lib/analytics/metrics";
import type { Tables } from "@/types/database.types";

// Plain-language insights across the mailboxes a single campaign actually
// sends from — not another health score. Every rate comes straight from
// lib/analytics/mailbox-metrics.ts's summarizeMailboxMetrics (the same
// engine Mailbox Analytics uses); this module only groups that engine's
// output per mailbox and finds extremes/thresholds across the results — the
// same "reduce to a max/min, flag past a cutoff" shape as
// lib/analytics/sequence-step-metrics.ts's identifyBestStep/
// identifyWeakestStep and lib/analytics/funnel.ts's identifyBiggestDropOff.
// No weighted average, no 0-100 score.

export interface CampaignLeadForMailboxInsights {
  id: string;
  mailbox_id: string | null;
}

export interface SendAttemptForMailboxInsights {
  campaign_lead_id: string;
  status: string;
}

export interface EmailEventForMailboxInsights {
  mailbox_id: string | null;
  event_type: string;
}

export interface MailboxForInsights {
  id: string;
  display_name: string | null;
  email: string;
}

export interface CampaignMailboxSummary {
  mailboxId: string;
  label: string;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  repliedCount: number;
  bouncedCount: number;
  deliveryRate: number | null;
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
  bounceRate: number | null;
}

// Same shape lib/analytics/insights.ts's shared Insight/InsightTone use —
// aliased (not redeclared) so this module's insights and the AI Insights
// engine's insights are interchangeable wherever both are rendered (see
// components/analytics/insights-card.tsx's InsightList).
export type MailboxInsightTone = InsightTone;
export type MailboxInsight = Insight;

export interface CampaignMailboxInsightsResult {
  mailboxes: CampaignMailboxSummary[];
  insights: MailboxInsight[];
}

export interface CampaignMailboxInsightsInput {
  campaign: Pick<Tables<"campaigns">, "default_mailbox_id">;
  campaignLeads: CampaignLeadForMailboxInsights[];
  sendAttempts: SendAttemptForMailboxInsights[];
  emailEvents: EmailEventForMailboxInsights[];
  // The caller's full mailbox list (e.g. listMailboxes()) — this module
  // filters it down to only the mailboxes this campaign's leads actually
  // resolve to before generating anything, rather than requiring the
  // caller to pre-filter.
  mailboxes: MailboxForInsights[];
}

// 5% bounce rate is the same commonly-cited hard ceiling already used in
// lib/campaigns/health-score.ts and lib/deliverability/scoring.ts — kept as
// its own local constant (not imported) so this module has no dependency on
// either scoring module's internals, the same independence
// lib/warmup/scoring.ts's own duplicated constant already establishes.
const HIGH_BOUNCE_RATE = 5;
// Percentage points behind the best-performing mailbox before the weakest
// one is called out as "significantly" underperforming (vs. just normal
// variance) — the trigger for the redistribute-volume suggestion.
const SIGNIFICANT_REPLY_RATE_GAP = 5;

function labelFor(mailbox: MailboxForInsights): string {
  return mailbox.display_name || mailbox.email;
}

export function buildCampaignMailboxInsights(input: CampaignMailboxInsightsInput): CampaignMailboxInsightsResult {
  const { campaign, campaignLeads, sendAttempts, emailEvents, mailboxes } = input;

  // Effective mailbox per lead reuses the exact resolution
  // checkCampaignReadiness already relies on (a lead's own override, or the
  // campaign's default) — see resolveLeadMailboxId — instead of
  // re-deriving that fallback here.
  const mailboxIdByLeadId = new Map<string, string>();
  const referencedMailboxIds = new Set<string>();
  for (const lead of campaignLeads) {
    const mailboxId = resolveLeadMailboxId(lead, campaign);
    if (!mailboxId) continue;
    mailboxIdByLeadId.set(lead.id, mailboxId);
    referencedMailboxIds.add(mailboxId);
  }

  const mailboxById = new Map(mailboxes.filter((mailbox) => referencedMailboxIds.has(mailbox.id)).map((mailbox) => [mailbox.id, mailbox]));

  const sentCountByMailbox = new Map<string, number>();
  for (const attempt of sendAttempts) {
    if (attempt.status !== "sent") continue;
    const mailboxId = mailboxIdByLeadId.get(attempt.campaign_lead_id);
    if (!mailboxId) continue;
    sentCountByMailbox.set(mailboxId, (sentCountByMailbox.get(mailboxId) ?? 0) + 1);
  }

  const eventsByMailbox = new Map<string, EmailEventForMailboxInsights[]>();
  for (const event of emailEvents) {
    if (!event.mailbox_id || !referencedMailboxIds.has(event.mailbox_id)) continue;
    const bucket = eventsByMailbox.get(event.mailbox_id);
    if (bucket) {
      bucket.push(event);
    } else {
      eventsByMailbox.set(event.mailbox_id, [event]);
    }
  }

  const summaries: CampaignMailboxSummary[] = [];
  for (const mailboxId of referencedMailboxIds) {
    const sentCount = sentCountByMailbox.get(mailboxId) ?? 0;
    if (sentCount === 0) continue; // no real sending activity yet — don't fabricate a summary

    const mailbox = mailboxById.get(mailboxId);
    if (!mailbox) continue; // referenced mailbox no longer exists/owned

    const eventCounts = groupCounts(eventsByMailbox.get(mailboxId) ?? [], (event) => event.event_type);
    // summarizeMailboxMetrics also computes spamComplaintRate, which this
    // module deliberately never reads: there's no per-campaign spam-
    // complaint data source to supply a real count, and passing 0 would
    // render as a real "0%" that isn't actually measured — the exact
    // fabricated-signal trap lib/campaigns/health-score.ts's own field
    // comments warn against.
    const metrics = summarizeMailboxMetrics({
      sentCount,
      deliveredCount: eventCounts.delivered ?? 0,
      openedCount: eventCounts.opened ?? 0,
      clickedCount: eventCounts.clicked ?? 0,
      repliedCount: eventCounts.replied ?? 0,
      bouncedCount: eventCounts.bounced ?? 0,
      spamComplaintCount: 0,
    });

    summaries.push({
      mailboxId,
      label: labelFor(mailbox),
      sentCount: metrics.sentCount,
      deliveredCount: metrics.deliveredCount,
      openedCount: metrics.openedCount,
      clickedCount: metrics.clickedCount,
      repliedCount: metrics.repliedCount,
      bouncedCount: metrics.bouncedCount,
      deliveryRate: metrics.deliveryRate,
      openRate: metrics.openRate,
      clickRate: metrics.clickRate,
      replyRate: metrics.replyRate,
      bounceRate: metrics.bounceRate,
    });
  }

  summaries.sort((a, b) => b.sentCount - a.sentCount);

  return { mailboxes: summaries, insights: buildInsights(summaries) };
}

function buildInsights(summaries: CampaignMailboxSummary[]): MailboxInsight[] {
  if (summaries.length === 0) return [];

  if (summaries.length === 1) {
    return [
      {
        key: "single_mailbox",
        tone: "info",
        message: `This campaign is only sending from one mailbox (${summaries[0].label}) — add more mailboxes to compare performance across them.`,
      },
    ];
  }

  const insights: MailboxInsight[] = [];
  let flaggedUnderperformance = false;

  const best = summaries.reduce((a, b) => ((b.replyRate ?? 0) > (a.replyRate ?? 0) ? b : a));
  const weakest = summaries.reduce((a, b) => ((b.replyRate ?? 0) < (a.replyRate ?? 0) ? b : a));
  const highestBounce = summaries.reduce((a, b) => ((b.bounceRate ?? 0) > (a.bounceRate ?? 0) ? b : a));

  if (best.mailboxId !== weakest.mailboxId) {
    const gap = (best.replyRate ?? 0) - (weakest.replyRate ?? 0);
    const significant = gap >= SIGNIFICANT_REPLY_RATE_GAP || (weakest.bounceRate ?? 0) >= HIGH_BOUNCE_RATE;

    insights.push({
      key: "best_mailbox",
      tone: "good",
      message: `${best.label} is this campaign's best-performing mailbox — ${best.replyRate}% reply rate (${best.repliedCount} of ${best.sentCount} sent).`,
    });
    insights.push({
      key: "weakest_mailbox",
      tone: significant ? "warning" : "info",
      message: `${weakest.label} has the lowest reply rate in this campaign — ${weakest.replyRate}% (${weakest.repliedCount} of ${weakest.sentCount} sent).`,
    });

    if (significant) {
      flaggedUnderperformance = true;
      insights.push({
        key: "redistribute_volume",
        tone: "warning",
        message: `Consider redistributing volume away from ${weakest.label} toward ${best.label} — its reply rate is significantly behind (${weakest.replyRate}% vs. ${best.replyRate}%).`,
      });
    }
  }

  const bounceIsWarning = (highestBounce.bounceRate ?? 0) >= HIGH_BOUNCE_RATE;
  if (bounceIsWarning) flaggedUnderperformance = true;
  insights.push({
    key: "highest_bounce_mailbox",
    tone: bounceIsWarning ? "warning" : "info",
    message: bounceIsWarning
      ? `${highestBounce.label} has an elevated bounce rate — ${highestBounce.bounceRate}% (${highestBounce.bouncedCount} of ${highestBounce.sentCount} sent).`
      : `${highestBounce.label} has this campaign's highest bounce rate, ${highestBounce.bounceRate}%, still within a healthy range.`,
  });

  if (!flaggedUnderperformance) {
    const replyRates = summaries.map((summary) => summary.replyRate ?? 0);
    insights.push({
      key: "all_healthy_consistent",
      tone: "good",
      message: `All ${summaries.length} mailboxes in this campaign are healthy and performing consistently — reply rates range from ${Math.min(...replyRates)}% to ${Math.max(...replyRates)}%, with no elevated bounce rate.`,
    });
  }

  return insights;
}
