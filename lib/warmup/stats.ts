import type { Tables } from "@/types/database.types";

// Pure aggregation over one day's warmup_messages rows for a single profile
// — kept separate from lib/warmup/warmup-worker.ts's DB/SMTP/IMAP-heavy
// orchestration so it's unit-testable on its own, same reasoning
// lib/warmup/scoring.ts and lib/warmup/scheduler.ts already follow.
//
// bounce_rate and spam_rate (both columns on warmup_stats) are deliberately
// not computed here: a failed or bounced send is never inserted into
// warmup_messages — sendWarmupMessage in warmup-worker.ts only inserts a row
// on success — and nothing detects spam-folder placement at all, so there is
// no real signal to average for either. Leaving those two columns unset
// (they stay null, per the migration's nullable definition) is correct; a
// computed 0% would misreport "not measured" as "measured zero".

export interface WarmupMessageForStats {
  message_type: Tables<"warmup_messages">["message_type"];
  reply_decision: Tables<"warmup_messages">["reply_decision"];
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
}

export function computeDailyWarmupStats(sentMessages: WarmupMessageForStats[], emailsReceived: number): DailyWarmupStats {
  const initialMessages = sentMessages.filter((message) => message.message_type === "initial");
  const repliedInitialMessages = initialMessages.filter((message) => message.reply_decision === "replied");

  return {
    emailsSent: sentMessages.length,
    emailsReceived,
    replyRate:
      initialMessages.length > 0 ? Math.round((repliedInitialMessages.length / initialMessages.length) * 10000) / 100 : null,
    positiveInteractions: repliedInitialMessages.length,
  };
}
