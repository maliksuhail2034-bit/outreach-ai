import type { Client } from "@/lib/db/shared";
import type { Tables, TablesUpdate } from "@/types/database.types";
import {
  claimDueWarmupSends,
  releaseWarmupProfileLock,
  updateWarmupProfile,
  insertWarmupEvent,
  insertWarmupMessage,
  updateWarmupMessage,
  getWarmupMessageByProviderMessageId,
  listDueWarmupReplies,
  countWarmupMessagesSentToday,
  listWarmupMessagesSentOnDate,
  countWarmupMessagesReceivedOnDate,
  upsertWarmupStat,
  listWarmupProfiles,
  getMailboxCredentials,
} from "@/lib/db";
import { getEmailProvider } from "@/lib/email/get-provider";
import { getReplyProvider } from "@/lib/email/get-reply-provider";
import { EmailSendError, type OutboundEmailMessage } from "@/lib/email/provider";
import { computeNextSendTime, DEFAULT_SENDING_WINDOW } from "@/lib/email/scheduling";
import { WARMUP_ENGINE_ORGANIZATION_ID } from "./owner-scope";
import { forecastNextRamp, randomizedNextSendDelayMinutes } from "./scheduler";
import { canTransition, nextStageForStatusChange, transition } from "./state-machine";
import { calculateWarmupScore } from "./scoring";
import { computeDailyWarmupStats } from "./stats";
import { INITIAL_TEMPLATES, REPLY_TEMPLATES, pickTemplate } from "./templates";
import type { WarmupStage } from "./types";

// Orchestrates one warmup cycle: claim due profiles, ramp/advance each,
// detect+queue replies to inbound peer mail, send due replies, and
// (volume/schedule permitting) start a fresh conversation with a random
// peer. Mirrors lib/email/send-worker.ts's shape exactly — orchestration
// only, no business logic of its own — and never touches
// claim_due_sends()/campaign_leads/send_attempts/email_events or
// mailboxes.imap_last_uid (the real reply-sync pipeline's cursor). See the
// plan's isolation checklist.

const DEFAULT_CLAIM_LIMIT = 10;

// Auto-pause threshold: a bounce pauses immediately (see
// classifyWarmupFailure), any other failure pauses once consecutive
// failures reach this.
const CONSECUTIVE_FAILURE_PAUSE_THRESHOLD = 3;

// Not every detected peer warmup email gets a reply — a 100% reply rate is
// itself a mechanical-looking pattern.
const REPLY_PROBABILITY = 0.6;
const MIN_REPLY_DELAY_MINUTES = 15;
const MAX_REPLY_DELAY_MINUTES = 120;

export interface WarmupCycleSummary {
  claimed: number;
  sent: number;
  repliesSent: number;
  bounced: number;
  paused: number;
  skipped: number;
}

export interface RunWarmupCycleOptions {
  limit?: number;
  // See the plan's verification section: runs the full claim -> ramp check
  // -> peer selection -> templating -> threading-header logic and logs what
  // it would do, without calling provider.send() or writing
  // warmup_messages/mutating current_daily_volume/imap cursors/next_send_at.
  // Read from WARMUP_DRY_RUN once in app/api/cron/warmup-cycle/route.ts and
  // passed in here — this module never reads process.env itself, matching
  // how send-worker.ts never reads CRON_SECRET either.
  dryRun?: boolean;
}

export async function runWarmupCycleWorker(
  supabase: Client,
  options: RunWarmupCycleOptions = {},
): Promise<WarmupCycleSummary> {
  const limit = options.limit ?? DEFAULT_CLAIM_LIMIT;
  const dryRun = options.dryRun ?? false;

  const claimed = await claimDueWarmupSends(supabase, WARMUP_ENGINE_ORGANIZATION_ID, limit);
  const summary: WarmupCycleSummary = { claimed: claimed.length, sent: 0, repliesSent: 0, bounced: 0, paused: 0, skipped: 0 };

  await processClaimedWarmupProfiles(supabase, claimed, summary, dryRun, processWarmupProfile);

  return summary;
}

export interface ProcessWarmupProfileOutcome {
  sent: number;
  repliesSent: number;
  bounced: number;
  paused: boolean;
}

// Sequential (3 mailboxes today, no need for send-worker.ts's concurrency
// lanes) and injectable — same reason processClaimedLeads takes processOne
// as a parameter: this loop's own tally/error-handling/lease-release logic
// is unit-testable without re-mocking the DB/SMTP/IMAP-heavy
// processWarmupProfile.
export async function processClaimedWarmupProfiles(
  supabase: Client,
  claimed: Tables<"warmup_profiles">[],
  summary: WarmupCycleSummary,
  dryRun: boolean,
  processOne: (supabase: Client, profile: Tables<"warmup_profiles">, dryRun: boolean) => Promise<ProcessWarmupProfileOutcome>,
): Promise<void> {
  for (const profile of claimed) {
    try {
      const outcome = await processOne(supabase, profile, dryRun);
      summary.sent += outcome.sent;
      summary.repliesSent += outcome.repliesSent;
      summary.bounced += outcome.bounced;
      if (outcome.paused) summary.paused += 1;
      if (outcome.sent === 0 && outcome.repliesSent === 0 && !outcome.paused) summary.skipped += 1;
    } catch (error) {
      console.error("[warmup-worker] profile cycle failed", {
        warmupProfileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
      summary.skipped += 1;
    } finally {
      // Always release the claim lease, dry-run or not — dry-run only skips
      // business-logic writes (sends, ramp/volume/cursor mutations), never
      // the lease itself, so a dry-run invocation never leaves a profile
      // artificially unclaimable for the next 10 minutes.
      await releaseWarmupProfileLock(supabase, profile.id).catch(() => undefined);
    }
  }
}

async function processWarmupProfile(
  supabase: Client,
  claimedProfile: Tables<"warmup_profiles">,
  dryRun: boolean,
): Promise<ProcessWarmupProfileOutcome> {
  const now = new Date();
  const profile = await advanceRampAndStage(supabase, claimedProfile, now, dryRun);
  const outcome: ProcessWarmupProfileOutcome = { sent: 0, repliesSent: 0, bounced: 0, paused: profile.status === "paused" };

  const mailbox = await getMailboxCredentials(supabase, profile.mailbox_id);

  await pollInboundWarmupMessages(supabase, profile, mailbox, dryRun);

  const dueReplies = await listDueWarmupReplies(supabase, mailbox.id, now.toISOString());
  for (const due of dueReplies) {
    if (profile.status !== "enabled") break; // stop once auto-paused mid-cycle
    const replyTemplate = pickTemplate(REPLY_TEMPLATES);
    const originalSender = await getMailboxCredentials(supabase, due.from_mailbox_id);

    const result = await sendWarmupMessage({
      supabase,
      profile,
      dryRun,
      fromMailbox: mailbox,
      toMailboxId: due.from_mailbox_id,
      toEmail: originalSender.email,
      toDisplayName: originalSender.display_name,
      messageType: "reply",
      subject: `Re: ${due.subject}`,
      bodyText: replyTemplate.body,
      inReplyTo: due.provider_message_id,
      references: [due.provider_message_id],
    });

    if (result.ok) {
      if (!dryRun) {
        await updateWarmupMessage(supabase, due.id, { reply_decision: "replied", replied_at: new Date().toISOString() });
      }
      outcome.repliesSent += 1;
    } else {
      if (result.bounced) outcome.bounced += 1;
      if (result.paused) outcome.paused = true;
    }
  }

  if (profile.status === "enabled" && isDue(profile.next_send_at, now)) {
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await countWarmupMessagesSentToday(supabase, profile.id, startOfDay.toISOString());

    if (sentToday < profile.current_daily_volume) {
      const orgProfiles = await listWarmupProfiles(supabase, profile.organization_id);
      const peer = selectWarmupPeer(orgProfiles, profile.mailbox_id);

      if (peer) {
        const peerMailbox = await getMailboxCredentials(supabase, peer.mailbox_id);
        const template = pickTemplate(INITIAL_TEMPLATES);

        const result = await sendWarmupMessage({
          supabase,
          profile,
          dryRun,
          fromMailbox: mailbox,
          toMailboxId: peerMailbox.id,
          toEmail: peerMailbox.email,
          toDisplayName: peerMailbox.display_name,
          messageType: "initial",
          subject: template.subject,
          bodyText: template.body,
        });

        if (result.ok) outcome.sent += 1;
        else {
          if (result.bounced) outcome.bounced += 1;
          if (result.paused) outcome.paused = true;
        }
      }
    }

    if (profile.status === "enabled" && !outcome.paused) {
      const delayMinutes = randomizedNextSendDelayMinutes(profile.current_daily_volume, DEFAULT_SENDING_WINDOW);
      const nextSendAt = computeNextSendTime({
        from: new Date(now.getTime() + delayMinutes * 60_000),
        dayDelay: 0,
        window: DEFAULT_SENDING_WINDOW,
      });

      if (dryRun) {
        console.log("[warmup-worker] dry-run: would set next_send_at", {
          warmupProfileId: profile.id,
          nextSendAt: nextSendAt.toISOString(),
        });
      } else {
        await updateWarmupProfile(supabase, profile.organization_id, profile.mailbox_id, {
          next_send_at: nextSendAt.toISOString(),
        });
      }
    }
  }

  try {
    await recordDailyWarmupStats(supabase, profile, now, dryRun);
  } catch (error) {
    // Stats aggregation is analytics on top of the real warmup work above,
    // not core warmup behavior — a transient failure here (DB hiccup,
    // network blip) must never turn an already-successful send/reply/ramp
    // cycle into a profile the cron summary reports as skipped. Mirrors
    // pollInboundWarmupMessages's own per-mailbox soft-skip below: log and
    // move on, `outcome` (and thus this profile's sent/repliesSent/bounced/
    // paused tally) is unaffected either way.
    console.error("[warmup-worker] stats aggregation failed", {
      warmupProfileId: profile.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return outcome;
}

// Final step of a profile's cycle: refresh today's warmup_stats row.
// Recomputed from
// warmup_messages on every cycle rather than incremented — same "derive,
// don't drift" reasoning as countWarmupMessagesSentToday above — so
// upsertWarmupStat's (warmup_profile_id, stat_date) conflict target always
// replaces today's row with the correct total instead of double-counting.
// Runs unconditionally (not just when this cycle sent something): the
// inbound poll above can flip a reply_decision from 'pending' to 'replied'
// with no new send of its own, which still changes today's replyRate.
// Failure here is isolated by the caller (processWarmupProfile) — this
// function itself still throws on error so dry-run/real-run behavior and
// the raw failure signal stay intact for whichever caller does the catching.
async function recordDailyWarmupStats(
  supabase: Client,
  profile: Tables<"warmup_profiles">,
  now: Date,
  dryRun: boolean,
): Promise<void> {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const [sentMessages, emailsReceived] = await Promise.all([
    listWarmupMessagesSentOnDate(supabase, profile.id, startOfDay.toISOString(), endOfDay.toISOString()),
    countWarmupMessagesReceivedOnDate(supabase, profile.mailbox_id, startOfDay.toISOString(), endOfDay.toISOString()),
  ]);

  const stats = computeDailyWarmupStats(sentMessages, emailsReceived);
  // bounceRate/spamRate are omitted — see lib/warmup/stats.ts's header
  // comment on why neither has a real signal to average yet.
  const warmupScore = calculateWarmupScore({
    stage: profile.stage as WarmupStage,
    targetDailyVolume: profile.target_daily_volume,
    currentDailyVolume: profile.current_daily_volume,
    replyRate: stats.replyRate,
  });
  const statDate = startOfDay.toISOString().slice(0, 10);

  if (dryRun) {
    console.log("[warmup-worker] dry-run: would upsert warmup_stats", { warmupProfileId: profile.id, statDate, ...stats, warmupScore });
    return;
  }

  await upsertWarmupStat(supabase, {
    warmup_profile_id: profile.id,
    organization_id: profile.organization_id,
    stat_date: statDate,
    emails_sent: stats.emailsSent,
    emails_received: stats.emailsReceived,
    reply_rate: stats.replyRate,
    positive_interactions: stats.positiveInteractions,
    warmup_score: warmupScore,
  });
}

function isDue(nextSendAt: string | null, now: Date): boolean {
  return nextSendAt === null || new Date(nextSendAt) <= now;
}

// Step 1: ramp/stage advance. Reuses forecastNextRamp/canTransition/
// transition/calculateWarmupScore exactly as the existing /warmup UI
// actions already do — this only makes the numbers real by finally
// persisting them on a schedule instead of only computing them for display.
async function advanceRampAndStage(
  supabase: Client,
  profile: Tables<"warmup_profiles">,
  now: Date,
  dryRun: boolean,
): Promise<Tables<"warmup_profiles">> {
  const forecast = forecastNextRamp(
    {
      stage: profile.stage as WarmupStage,
      targetDailyVolume: profile.target_daily_volume,
      currentDailyVolume: profile.current_daily_volume,
      rampUpPercent: profile.ramp_up_percent,
      lastActivityAt: profile.last_ramp_increase_at ?? profile.started_at,
    },
    now,
  );

  if (forecast.nextVolume === null || !forecast.nextIncreaseAt || new Date(forecast.nextIncreaseAt) > now) {
    return profile;
  }

  const currentStage = profile.stage as WarmupStage;
  let nextStage = currentStage;
  if (currentStage === "starting" && canTransition("starting", "warming")) {
    nextStage = transition("starting", "warming");
  } else if (currentStage === "warming" && forecast.nextVolume >= profile.target_daily_volume && canTransition("warming", "healthy")) {
    nextStage = transition("warming", "healthy");
  }

  const healthScore = calculateWarmupScore({
    stage: nextStage,
    targetDailyVolume: profile.target_daily_volume,
    currentDailyVolume: forecast.nextVolume,
  });

  if (dryRun) {
    console.log("[warmup-worker] dry-run: would advance ramp", {
      warmupProfileId: profile.id,
      currentDailyVolume: forecast.nextVolume,
      stage: nextStage,
      healthScore,
    });
    return {
      ...profile,
      current_daily_volume: forecast.nextVolume,
      stage: nextStage,
      health_score: healthScore,
      last_ramp_increase_at: now.toISOString(),
    };
  }

  const updated = await updateWarmupProfile(supabase, profile.organization_id, profile.mailbox_id, {
    current_daily_volume: forecast.nextVolume,
    last_ramp_increase_at: now.toISOString(),
    stage: nextStage,
    health_score: healthScore,
  });

  await insertWarmupEvent(supabase, {
    warmup_profile_id: profile.id,
    organization_id: profile.organization_id,
    event_type: currentStage === nextStage ? "volume_adjusted" : "stage_changed",
    detail: `current_daily_volume -> ${forecast.nextVolume}${currentStage !== nextStage ? `, stage ${currentStage} -> ${nextStage}` : ""}`,
  });

  return updated;
}

// Step 2: poll this mailbox's real IMAP inbox for newly-arrived peer
// warmup mail, using this feature's OWN cursor (profile.imap_last_uid/
// imap_uid_validity) — never mailboxes.imap_last_uid, which belongs to the
// real reply-sync pipeline (lib/email/reply-worker.ts) and must never race
// with it on the same physical mailbox. Reuses ImapReplyChecker (via
// getReplyProvider) as pure, non-destructive IMAP mechanics only — it never
// marks messages as seen or deletes anything.
async function pollInboundWarmupMessages(
  supabase: Client,
  profile: Tables<"warmup_profiles">,
  mailbox: Tables<"mailboxes">,
  dryRun: boolean,
): Promise<void> {
  if (!mailbox.imap_enabled) return;

  const patchedMailbox: Tables<"mailboxes"> = {
    ...mailbox,
    imap_last_uid: profile.imap_last_uid,
    imap_uid_validity: profile.imap_uid_validity,
  };

  let result;
  try {
    result = await getReplyProvider(patchedMailbox).fetchNewMessages();
  } catch (error) {
    // One mailbox's IMAP failure must not stop the rest of its cycle —
    // mirrors reply-worker.ts's per-mailbox soft-skip.
    console.error("[warmup-worker] imap poll failed", {
      warmupProfileId: profile.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (dryRun) {
    console.log("[warmup-worker] dry-run: would advance imap cursor and evaluate replies", {
      warmupProfileId: profile.id,
      messagesFetched: result.messages.length,
      cursor: result.cursor,
    });
  } else {
    await updateWarmupProfile(supabase, profile.organization_id, profile.mailbox_id, {
      imap_uid_validity: result.cursor.uidValidity,
      imap_last_uid: result.cursor.lastUid,
    });
  }

  for (const message of result.messages) {
    const original = await getWarmupMessageByProviderMessageId(supabase, message.messageId);
    // Only ever react to our own 'initial' messages landing back in the
    // recipient's inbox — never to a 'reply', which bounds every thread to
    // one hop and prevents infinite ping-pong between the owned mailboxes.
    if (!original || original.message_type !== "initial" || original.to_mailbox_id !== mailbox.id || original.reply_decision !== "undecided") {
      continue;
    }

    const shouldReply = Math.random() < REPLY_PROBABILITY;
    if (dryRun) {
      console.log("[warmup-worker] dry-run: would set reply_decision", {
        warmupMessageId: original.id,
        decision: shouldReply ? "pending" : "skipped",
      });
      continue;
    }

    if (shouldReply) {
      const delayMinutes = MIN_REPLY_DELAY_MINUTES + Math.random() * (MAX_REPLY_DELAY_MINUTES - MIN_REPLY_DELAY_MINUTES);
      await updateWarmupMessage(supabase, original.id, {
        reply_decision: "pending",
        reply_due_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      });
    } else {
      await updateWarmupMessage(supabase, original.id, { reply_decision: "skipped" });
    }
  }
}

// Pure: picks a random enabled peer profile (excluding self) from a list of
// this organization's warmup profiles. Scales to more than 3 mailboxes with
// zero change — "all enabled profiles other than mine" naturally grows with
// the peer pool.
export function selectWarmupPeer(
  candidates: Pick<Tables<"warmup_profiles">, "mailbox_id" | "status">[],
  selfMailboxId: string,
): Pick<Tables<"warmup_profiles">, "mailbox_id"> | null {
  const eligible = candidates.filter((candidate) => candidate.status === "enabled" && candidate.mailbox_id !== selfMailboxId);
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export interface FailureDecision {
  consecutiveFailures: number;
  shouldPause: boolean;
}

// Pure: a bounce pauses immediately (an address-level rejection means
// something is genuinely wrong, not worth retrying blindly); any other
// failure pauses once consecutive failures cross `threshold`. Mirrors the
// EmailSendError three-outcome vocabulary the campaign pipeline already
// uses (lib/email/provider.ts), reused here rather than reinvented.
export function classifyWarmupFailure(
  outcome: EmailSendError["outcome"],
  currentConsecutiveFailures: number,
  threshold: number,
): FailureDecision {
  if (outcome === "bounced") {
    return { consecutiveFailures: currentConsecutiveFailures + 1, shouldPause: true };
  }
  const consecutiveFailures = currentConsecutiveFailures + 1;
  return { consecutiveFailures, shouldPause: consecutiveFailures >= threshold };
}

interface SendWarmupMessageParams {
  supabase: Client;
  profile: Tables<"warmup_profiles">;
  dryRun: boolean;
  fromMailbox: Tables<"mailboxes">;
  toMailboxId: string;
  toEmail: string;
  toDisplayName?: string | null;
  messageType: "initial" | "reply";
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
}

interface SendWarmupMessageResult {
  ok: boolean;
  bounced: boolean;
  paused: boolean;
}

// The one place that actually calls the real SMTP send — used by both the
// reply step and the new-conversation step, so failure classification/
// auto-pause logic exists exactly once. Reuses getEmailProvider/
// SmtpEmailProvider exactly as send-worker.ts does; never touches
// email_events/campaign_leads/send_attempts.
async function sendWarmupMessage(params: SendWarmupMessageParams): Promise<SendWarmupMessageResult> {
  const { supabase, profile, dryRun, fromMailbox, toMailboxId, toEmail, toDisplayName, messageType, subject, bodyText, inReplyTo, references } = params;

  if (dryRun) {
    console.log("[warmup-worker] dry-run: would send", {
      warmupProfileId: profile.id,
      messageType,
      from: fromMailbox.email,
      to: toEmail,
      subject,
      inReplyTo: inReplyTo ?? null,
    });
    return { ok: true, bounced: false, paused: false };
  }

  const message: OutboundEmailMessage = {
    from: { name: fromMailbox.display_name ?? undefined, email: fromMailbox.email },
    to: { name: toDisplayName ?? undefined, email: toEmail },
    subject,
    html: `<p>${bodyText}</p>`,
    text: bodyText,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
  };

  try {
    const result = await getEmailProvider(fromMailbox).send(message);

    await insertWarmupMessage(supabase, {
      organization_id: profile.organization_id,
      from_mailbox_id: fromMailbox.id,
      to_mailbox_id: toMailboxId,
      from_warmup_profile_id: profile.id,
      message_type: messageType,
      provider_message_id: result.providerMessageId,
      in_reply_to: inReplyTo ?? null,
      subject,
      status: "sent",
    });

    if (profile.consecutive_failures > 0) {
      await updateWarmupProfile(supabase, profile.organization_id, profile.mailbox_id, { consecutive_failures: 0 });
      profile.consecutive_failures = 0;
    }

    return { ok: true, bounced: false, paused: false };
  } catch (error) {
    const outcome = error instanceof EmailSendError ? error.outcome : "failed";
    const decision = classifyWarmupFailure(outcome, profile.consecutive_failures, CONSECUTIVE_FAILURE_PAUSE_THRESHOLD);

    const updates: TablesUpdate<"warmup_profiles"> = { consecutive_failures: decision.consecutiveFailures };
    if (decision.shouldPause) {
      updates.status = "paused";
      updates.stage = nextStageForStatusChange(profile.stage as WarmupStage, "paused");
    }
    await updateWarmupProfile(supabase, profile.organization_id, profile.mailbox_id, updates);
    profile.consecutive_failures = decision.consecutiveFailures;
    if (decision.shouldPause) profile.status = "paused";

    if (decision.shouldPause) {
      await insertWarmupEvent(supabase, {
        warmup_profile_id: profile.id,
        organization_id: profile.organization_id,
        event_type: "warning",
        detail:
          outcome === "bounced"
            ? "Auto-paused after a bounce."
            : `Auto-paused after ${decision.consecutiveFailures} consecutive send failures.`,
      });
    }

    console.error("[warmup-worker] send failed", {
      warmupProfileId: profile.id,
      messageType,
      outcome,
      error: error instanceof Error ? error.message : String(error),
    });

    return { ok: false, bounced: outcome === "bounced", paused: decision.shouldPause };
  }
}
