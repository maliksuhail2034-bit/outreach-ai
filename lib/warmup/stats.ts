import type { Tables } from "@/types/database.types";

// Pure aggregation over one day's warmup_messages rows for a single profile
// — kept separate from lib/warmup/warmup-worker.ts's DB/SMTP/IMAP-heavy
// orchestration so it's unit-testable on its own, same reasoning
// lib/warmup/scoring.ts and lib/warmup/scheduler.ts already follow.
//
// spam_rate comes from inbox placement recorded by the recipients' inbox
// agents (lib/warmup/inbox-agent.ts) and stays null until any message has a
// known placement. bounce_rate is deliberately not computed: a failed or
// bounced send is never inserted into warmup_messages (sendWarmupMessage in
// warmup-worker.ts only inserts on success), so there is no signal for it,
// and a computed 0% would misreport "not measured" as "measured zero".

export interface WarmupMessageForStats {
  message_type: Tables<"warmup_messages">["message_type"];
  reply_decision: Tables<"warmup_messages">["reply_decision"];
  // Optional so callers/tests predating inbox placement still type-check.
  placement?: Tables<"warmup_messages">["placement"];
}

export interface DailyWarmupStats {
  emailsSent: number;
  emailsReceived: number;
  // Share of this profile's 'initial' sends (fresh conversations, not the
  // auto-replies this profile sent to others) that got a real reply back.
  // Null when no 'initial' message was sent that day — there is nothing to
  // take a rate of, and 0 would misreport "no data" as "no replies".
  replyRate: number | null;
  // Raw count backing replyRate — how many 'initial' sends this profile got
  // a genuine reply to.
  positiveInteractions: number;
  // Where the recipients' inbox agents found this profile's mail (see
  // lib/warmup/inbox-agent.ts). spamRate is spam ÷ (inbox + spam), null
  // until at least one message has a known placement.
  inboxCount: number;
  spamCount: number;
  spamRate: number | null;
}

export function computeDailyWarmupStats(sentMessages: WarmupMessageForStats[], emailsReceived: number): DailyWarmupStats {
  const initialMessages = sentMessages.filter((message) => message.message_type === "initial");
  const repliedInitialMessages = initialMessages.filter((message) => message.reply_decision === "replied");
  const inboxCount = sentMessages.filter((message) => message.placement === "inbox").length;
  const spamCount = sentMessages.filter((message) => message.placement === "spam").length;
  const placed = inboxCount + spamCount;

  return {
    emailsSent: sentMessages.length,
    emailsReceived,
    replyRate:
      initialMessages.length > 0 ? Math.round((repliedInitialMessages.length / initialMessages.length) * 10000) / 100 : null,
    positiveInteractions: repliedInitialMessages.length,
    inboxCount,
    spamCount,
    spamRate: placed > 0 ? Math.round((spamCount / placed) * 10000) / 100 : null,
  };
}

export interface WarmupPeriodSummary {
  sent: number;
  received: number;
  replies: number;
  inbox: number;
  spam: number;
  // inbox ÷ (inbox + spam), null until any placement is known.
  inboxRate: number | null;
}

export const WARMUP_SUMMARY_DAYS = 7;

// First stat_date (UTC, YYYY-MM-DD) of the dashboard's rolling summary window.
export function warmupSummarySinceDate(now: Date = new Date()): string {
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (WARMUP_SUMMARY_DAYS - 1));
  return since.toISOString().slice(0, 10);
}

// Sums daily warmup_stats rows into one summary per profile.
export function summarizeWarmupStats(
  rows: {
    warmup_profile_id: string;
    emails_sent: number;
    emails_received: number;
    positive_interactions: number;
    inbox_count: number;
    spam_count: number;
  }[],
): Record<string, WarmupPeriodSummary> {
  const byProfile: Record<string, WarmupPeriodSummary> = {};
  for (const row of rows) {
    const summary = (byProfile[row.warmup_profile_id] ??= { sent: 0, received: 0, replies: 0, inbox: 0, spam: 0, inboxRate: null });
    summary.sent += row.emails_sent;
    summary.received += row.emails_received;
    summary.replies += row.positive_interactions;
    summary.inbox += row.inbox_count;
    summary.spam += row.spam_count;
  }
  for (const summary of Object.values(byProfile)) {
    const placed = summary.inbox + summary.spam;
    summary.inboxRate = placed > 0 ? Math.round((summary.inbox / placed) * 1000) / 10 : null;
  }
  return byProfile;
}
