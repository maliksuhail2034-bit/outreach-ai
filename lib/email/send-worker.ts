import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import {
  claimDueSends,
  claimSendAttempt,
  consumeSendNow,
  deferDueCampaignLeads,
  getCampaignById,
  getLeadById,
  getMailboxCredentials,
  getSendAttempt,
  getSettings,
  getSuppression,
  listAttachmentsForStepScoped,
  listSequenceSteps,
  listSequences,
  recordSendFailure,
  recordSendSuccess,
  updateCampaignLead,
} from "@/lib/db";
import { isWithinMonthlyEmailLimit } from "@/lib/billing/limits";
import { getEmailProvider } from "./get-provider";
import { EmailSendError } from "./provider";
import { escapeHtml, unescapeHtml } from "./merge-tags";
import { renderEmailContent } from "./render-email";
import type { MergeTagLead } from "./merge-tags";
import { buildAttachmentPayload, type DownloadedAttachment } from "./attachment-payload";
import { ATTACHMENTS_BUCKET } from "./attachment-validation";
import { computeNextSchedule, computeRetryDelay, findPreviousStep, resolveSendDecision } from "./scheduling";
import { buildUnsubscribeUrl } from "./unsubscribe-token";
import { buildOpenTrackingUrl, type OpenTrackingContext, buildClickTrackingUrl, type ClickTrackingContext } from "./tracking-token";
import { captureError } from "@/lib/monitoring/error-tracking";

const DEFAULT_UNSUBSCRIBE_FOOTER_TEXT = "Don't want to receive these emails?";

const DEFAULT_CLAIM_LIMIT = 25;

// Scalability Track, Phase D (item 12): the Phase B orchestration
// (processClaimedLeads below) is unchanged by this cutover — only this
// constant moves, from 1 (fully sequential, matching the original plain
// `for...of` loop) to a deliberately modest first real value. 5 lets up to
// five *different* mailboxes send in parallel per invocation — a real
// throughput gain for any org running multiple mailboxes, out of a claim
// batch of DEFAULT_CLAIM_LIMIT (25) — without a large first jump. Two leads
// for the same mailbox are still never processed concurrently regardless of
// this value: that invariant is structural (inFlightMailboxIds below), not
// a function of the concurrency number.
const DEFAULT_CONCURRENCY = 5;

// Wall-clock budget for one runSendWorker() invocation, checked only between
// claimed leads — never mid-send. A batch of DEFAULT_CLAIM_LIMIT slow/timing
// -out sends (each bounded by SMTP_TIMEOUTS, up to ~30s) could otherwise run
// the whole cron invocation well past its ~5 minute trigger cadence with no
// upper bound. Reliability Track item 2. Deliberately does not touch
// claim_due_sends()/send_attempts/the retry ladder: a lead left unprocessed
// when the budget is hit simply stays claimed until its existing
// locked_until lease expires, then is reclaimed by the next cron tick like
// any other in-flight claim — the same self-heal every other early-return
// path in this file already relies on.
const INVOCATION_TIME_BUDGET_MS = 4 * 60_000;

// Caps send_attempts.attempt_count — once a retryable failure's attempt
// count reaches this, it's no longer reclaimed automatically; the next
// failure is recorded as terminal ('failed') instead of 'retry'. No separate
// enforcement mechanism is needed beyond that: record_send_failure's
// 'failed' outcome sets campaign_leads.status = 'failed', and
// claim_due_sends() only ever selects status = 'active', so a capped-out
// lead simply stops being reclaimed.
const MAX_SEND_ATTEMPTS = 5;

export interface SendWorkerSummary {
  claimed: number;
  sent: number;
  failed: number;
  needsReview: number;
  skipped: number;
}

export type ProcessOutcome = "sent" | "failed" | "needsReview" | "skipped";

// Orchestration only: every step below delegates to a helper already built
// in earlier tasks (claiming, scheduling math, merge tags, provider send,
// ledger writes) — this file contains no scheduling, merge-tag, or
// duplicate-send-prevention logic of its own.
export async function runSendWorker(
  supabase: Client,
  limit = DEFAULT_CLAIM_LIMIT,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<SendWorkerSummary> {
  const startedAt = Date.now();

  const claimed = await claimDueSends(supabase, limit);
  const summary: SendWorkerSummary = { claimed: claimed.length, sent: 0, failed: 0, needsReview: 0, skipped: 0 };

  await processClaimedLeads(supabase, claimed, concurrency, startedAt, summary, processCampaignLead);

  return summary;
}

// Processes claimed leads with up to `concurrency` in flight at once, with
// one hard invariant: two leads for the same mailbox_id are never processed
// concurrently. claim_due_sends() already guarantees this across the whole
// system — at most one lead per mailbox per batch, and never a lead for a
// mailbox with a send still in flight (see
// 20260925100000_claim_due_sends_per_mailbox_capacity.sql), which is also
// what keeps its daily/hourly/cooldown checks exact. This in-process check is
// defense in depth on top of that, not the enforcement point. Same-
// mailbox serialization is structural (inFlightMailboxIds below) and holds
// regardless of `concurrency`'s value — raising it only lets *different*
// mailboxes' lanes run in parallel. Item 12 (Scalability Track, Phase D)
// raises DEFAULT_CONCURRENCY above; this orchestration itself, built in
// Phase B, is unchanged by that cutover.
//
// `processOne` is injected (always processCampaignLead in production, via
// runSendWorker above) so this orchestration logic — the actual new code
// this track's item 12 adds — is unit-testable on its own, without
// re-mocking the entire send pipeline processCampaignLead already owns and
// is already exercised by. Exported for exactly that reason.
export async function processClaimedLeads(
  supabase: Client,
  claimed: Tables<"campaign_leads">[],
  concurrency: number,
  startedAt: number,
  summary: SendWorkerSummary,
  processOne: (supabase: Client, campaignLead: Tables<"campaign_leads">) => Promise<ProcessOutcome>,
): Promise<void> {
  const queue = [...claimed];
  const inFlightMailboxIds = new Set<string>();
  let stoppedEarly = false;

  async function lane(): Promise<void> {
    while (queue.length > 0) {
      if (Date.now() - startedAt >= INVOCATION_TIME_BUDGET_MS) {
        if (!stoppedEarly) {
          stoppedEarly = true;
          console.log("[send-worker] time budget reached, stopping early", {
            processed: summary.sent + summary.failed + summary.needsReview + summary.skipped,
            claimed: claimed.length,
          });
        }
        return;
      }

      const index = queue.findIndex((lead) => !lead.mailbox_id || !inFlightMailboxIds.has(lead.mailbox_id));
      if (index === -1) {
        // Every remaining queued lead's mailbox is currently in flight in
        // another lane — wait briefly rather than busy-spinning. Only
        // reachable with concurrency > 1.
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      const [campaignLead] = queue.splice(index, 1);
      if (campaignLead.mailbox_id) inFlightMailboxIds.add(campaignLead.mailbox_id);

      try {
        const outcome = await processOne(supabase, campaignLead);
        summary[outcome] += 1;
      } finally {
        if (campaignLead.mailbox_id) inFlightMailboxIds.delete(campaignLead.mailbox_id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(concurrency, 1) }, () => lane()));
}

// Retrieves, re-validates, and downloads a step's attachments for one send —
// the only place send-worker.ts talks to Storage. Runs on the admin client
// (see runSendWorker/runCronJob), so listAttachmentsForStepScoped's explicit
// userId filter — not RLS — is what actually keeps this scoped to the
// campaign's owner.
//
// A configured attachment is not optional: if this step has any attachments
// at all and even one of them can't be downloaded, is missing from Storage,
// or fails re-validation, the whole send is aborted (thrown as an
// EmailSendError, "retry") rather than silently going out without it. Called
// from inside processCampaignLead's try block, before provider.send(), so
// this throw is caught by the exact same failure/retry/backoff path as any
// other send failure — see that catch block for the attempt-cap and
// recordSendFailure wiring this reuses unchanged.
// Exported only for lib/email/send-worker.test.ts — processCampaignLead
// itself (like before this batch) has no direct unit test, since exercising
// it needs every one of its DB/provider dependencies mocked; this function
// is the one piece of Batch 3's new behavior small enough to test on its
// own the same way this file's other pure/near-pure helpers are.
export async function loadAttachmentsForSend(
  supabase: Client,
  stepId: string,
  userId: string,
  logContext: { campaignLeadId: string; sequenceStepId: string },
) {
  const rows = await listAttachmentsForStepScoped(supabase, stepId, userId);
  if (rows.length === 0) return [];

  const downloaded: DownloadedAttachment[] = await Promise.all(
    rows.map(async (row) => {
      const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(row.storage_path);
      if (error || !data) {
        console.warn("[send-worker] attachment download failed", {
          ...logContext,
          attachmentId: row.id,
          error: error?.message,
        });
        return { metadata: row, bytes: null };
      }
      return { metadata: row, bytes: new Uint8Array(await data.arrayBuffer()) };
    }),
  );

  const { attachments, warnings } = buildAttachmentPayload(downloaded);
  if (warnings.length > 0) {
    // Logged with the attachment id/file name/reason (already the shape
    // buildAttachmentPayload's warnings use) — never raw file bytes or a
    // storage URL — plus the campaign lead/step this send belongs to.
    console.warn("[send-worker] attachment issue(s), aborting send", { ...logContext, warnings });
    throw new EmailSendError(
      `${warnings.length} of ${rows.length} configured attachment(s) could not be safely sent.`,
      "retry",
    );
  }
  return attachments;
}

// Batch 7: threading headers for a follow-up step. The provider abstraction
// (inReplyTo/references on OutboundEmailMessage) and SMTP implementation
// already exist — built for the warmup engine's auto-reply step
// (lib/warmup/warmup-worker.ts) — this is the campaign send path's first use
// of it. Mirrors warmup's own references shape exactly: a single-element
// array containing the immediate parent's provider_message_id, not an
// accumulated multi-hop chain — see warmup-worker.ts's sendWarmupMessage.
//
// "Previous step" is the sequence step immediately before targetStep by
// step_order (findPreviousStep), never current_step_id - 1 — step_order is
// the only ordering guarantee sequence_steps makes (see
// lib/db/sequence-steps.ts's swapSequenceStepOrder).
//
// Retry safety: this looks up the PREVIOUS step's send_attempts row, a
// different sequence_step_id than the one claimSendAttempt just claimed for
// the CURRENT step — a retry/reclaim of the current step's own attempt can
// therefore never become its own threading parent by construction, no
// special-casing needed. Only a previous attempt with status = 'sent' and a
// real provider_message_id is used; a missing, 'pending', or 'failed'
// previous attempt (or no previous step at all — the lead's first email)
// returns {}, so the send proceeds unthreaded exactly like today, rather
// than inventing a Message-ID.
export async function resolveThreadingHeaders(
  supabase: Client,
  steps: Tables<"sequence_steps">[],
  targetStep: Tables<"sequence_steps">,
  campaignLeadId: string,
): Promise<{ inReplyTo?: string; references?: string[] }> {
  const previousStep = findPreviousStep(steps, targetStep.id);
  if (!previousStep) return {};

  const previousAttempt = await getSendAttempt(supabase, campaignLeadId, previousStep.id);
  if (!previousAttempt || previousAttempt.status !== "sent" || !previousAttempt.provider_message_id) {
    return {};
  }

  return {
    inReplyTo: previousAttempt.provider_message_id,
    references: [previousAttempt.provider_message_id],
  };
}

// Batch 9A: open-tracking pixel injection, pulled out of processCampaignLead
// the same way loadAttachmentsForSend/resolveThreadingHeaders above are —
// small and pure enough to unit-test directly, without mocking the entire
// send pipeline processCampaignLead owns.
//
// HTML only, never the plain-text body: an <img> tag is invisible in an
// HTML email client but would show up as a raw, suspicious-looking URL if
// appended to the plain-text part, which is exactly the failure mode the
// unsubscribe-footer code above this avoids for its own link.
//
// Non-fatal by design: unlike the unsubscribe footer (a compliance
// requirement, added above), open tracking is a nice-to-have. A config
// problem (e.g. TRACKING_TOKEN_SECRET or NEXT_PUBLIC_APP_URL unset)
// degrades to "send without a pixel" rather than failing the send —
// otherwise turning this feature on in an environment missing that secret
// would break every single send for every org with tracking enabled.
export function injectOpenTrackingPixel(html: string, trackingEnabled: boolean, context: OpenTrackingContext): string {
  if (!trackingEnabled) return html;

  try {
    const pixelUrl = buildOpenTrackingUrl(context);
    return `${html}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0;" />`;
  } catch (error) {
    console.warn("[send-worker] failed to build open-tracking pixel, sending without it", {
      campaignLeadId: context.campaignLeadId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return html;
  }
}

// Only ever matches an href attribute value that already starts with
// http:// or https:// — this is what makes mailto:/tel:/#anchor/relative
// hrefs structurally impossible to match, not merely unlikely to occur.
// Matches the attribute value only (double-quoted, as every href this
// codebase ever generates — see render-email.ts/the unsubscribe footer
// below — is written), never the visible link text that follows it.
const HREF_URL_PATTERN = /href="(https?:\/\/[^"]*)"/g;

// Batch 9B: click-link rewriting, pulled out of processCampaignLead the
// same way injectOpenTrackingPixel above is — small and pure enough to
// unit-test directly, without mocking the entire send pipeline.
//
// Rewrites only the href attribute's URL, never the visible link text
// (which keeps showing the real destination to the recipient — the same
// UX every mainstream email platform's click tracking uses). excludeUrls
// lets the caller protect specific links (the unsubscribe link) from ever
// being wrapped, by exact match against the decoded destination — see the
// call site in processCampaignLead for why that's still needed even though
// the unsubscribe footer this file adds itself is appended afterward.
//
// Non-fatal by design, same reasoning as injectOpenTrackingPixel: a config
// problem degrades to "leave this one link untracked, still fully
// functional" rather than failing the send.
export function rewriteClickTrackingLinks(
  html: string,
  trackingEnabled: boolean,
  excludeUrls: string[],
  context: Omit<ClickTrackingContext, "destinationUrl">,
): string {
  if (!trackingEnabled) return html;

  return html.replace(HREF_URL_PATTERN, (match, rawHref: string) => {
    // rawHref is the href value as it appears in the already-HTML-escaped
    // body (see render-email.ts's linkifyEscapedText) — e.g. a literal
    // "&amp;" in place of a real "&" in the original URL's query string.
    // Decoded back to the real URL before it's compared, signed, or ever
    // used as an HTTP redirect target — a Location header is not HTML and
    // must never contain a literal HTML entity.
    const destinationUrl = unescapeHtml(rawHref);
    if (excludeUrls.includes(destinationUrl)) return match;

    try {
      const trackedUrl = buildClickTrackingUrl({ ...context, destinationUrl });
      return `href="${trackedUrl}"`;
    } catch (error) {
      console.warn("[send-worker] failed to build click-tracking link, leaving it untracked", {
        campaignLeadId: context.campaignLeadId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return match;
    }
  });
}

// Final sending-window check, run immediately before the send attempt (see
// processCampaignLead) so every way a lead can come due — a late worker run,
// a retry, a campaign resume, a manual reactivation — is covered in one
// place. The decision itself is resolveSendDecision (lib/email/scheduling.ts).
//
// Outside the window without a valid Send Now: the claimed lead moves to the
// next window opening and releases its lease, and so does every other lead of
// this campaign that's due right now (deferDueCampaignLeads) — all of them
// are outside the same window, so this avoids deferring them one claim at a
// time. next_send_at lands in the future, so nothing is reclaimed until the
// window opens. Status, mailbox and step are untouched; a stale Send Now for
// an earlier step is cleared, since it can never apply again.
//
// With a valid Send Now: the bypass is consumed here, before the send
// attempt, so if this send fails its retry waits for the window like any
// other, and a crash after this point can't re-use it either. The worker
// holds this lead's lease, and request_send_now() refuses leased leads, so
// nothing can set a new bypass concurrently. The consume is conditional
// (consumeSendNow): if the database no longer holds the bypass the claim
// returned — a pause after the claim clears it — the bypass is not used
// (handleLostSendNow).
export async function enforceSendingWindow(
  supabase: Client,
  campaignLead: Tables<"campaign_leads">,
  sendingWindow: unknown,
  now: Date = new Date(),
): Promise<"send" | "deferred"> {
  const decision = resolveSendDecision({
    now,
    sendingWindow,
    currentStepId: campaignLead.current_step_id,
    sendNowStepId: campaignLead.send_now_step_id,
  });

  if (decision.send) {
    // A stale value (left for an earlier step) is dropped here too, so no
    // bypass is ever still pending once this step's send is attempted.
    if (campaignLead.send_now_step_id !== null && campaignLead.current_step_id !== null) {
      const consumed = await consumeSendNow(
        supabase,
        campaignLead.id,
        campaignLead.send_now_step_id,
        campaignLead.current_step_id,
      );
      if (decision.usesSendNowBypass && !consumed) {
        return handleLostSendNow(supabase, campaignLead, sendingWindow, now);
      }
    }
    return "send";
  }

  await updateCampaignLead(supabase, campaignLead.id, {
    next_send_at: decision.nextSendAt.toISOString(),
    locked_until: null,
    send_now_step_id: null,
  });
  await deferDueCampaignLeads(supabase, campaignLead.campaign_id, decision.nextSendAt, now);
  console.log("[send-worker] outside sending window, deferred", {
    campaignLeadId: campaignLead.id,
    campaignId: campaignLead.campaign_id,
    nextSendAt: decision.nextSendAt.toISOString(),
  });
  return "deferred";
}

// The claimed copy showed a valid Send Now, but the database no longer has
// it — in practice because the campaign was paused (or otherwise left
// 'active') after the claim, whose trigger clears pending requests. The
// bypass is not used. A campaign that is no longer active sends nothing: the
// lease is released and next_send_at kept, so a resume picks the lead up
// again through the normal window check. Otherwise the lead goes through the
// normal window decision as if it never had a Send Now.
async function handleLostSendNow(
  supabase: Client,
  campaignLead: Tables<"campaign_leads">,
  sendingWindow: unknown,
  now: Date,
): Promise<"send" | "deferred"> {
  const campaign = await getCampaignById(supabase, campaignLead.campaign_id);
  if (campaign.status !== "active") {
    await updateCampaignLead(supabase, campaignLead.id, { locked_until: null });
    console.log("[send-worker] Send Now withdrawn by campaign status change, not sent", {
      campaignLeadId: campaignLead.id,
      campaignId: campaignLead.campaign_id,
      campaignStatus: campaign.status,
    });
    return "deferred";
  }
  return enforceSendingWindow(supabase, { ...campaignLead, send_now_step_id: null }, sendingWindow, now);
}

async function processCampaignLead(
  supabase: Client,
  campaignLead: Tables<"campaign_leads">,
): Promise<ProcessOutcome> {
  // Defensive only — claim_due_sends() already filters for both of these;
  // this just keeps the function total instead of throwing on a malformed
  // row.
  if (!campaignLead.current_step_id || !campaignLead.mailbox_id) {
    const errorMessage = "Claimed with no current_step_id or mailbox_id.";
    console.error("[send-worker] needs_review", { campaignLeadId: campaignLead.id, error: errorMessage });
    await updateCampaignLead(supabase, campaignLead.id, {
      status: "needs_review",
      last_error: errorMessage,
      locked_until: null,
    });
    return "needsReview";
  }

  const [campaign, lead, mailbox, sequences] = await Promise.all([
    getCampaignById(supabase, campaignLead.campaign_id),
    getLeadById(supabase, campaignLead.lead_id),
    getMailboxCredentials(supabase, campaignLead.mailbox_id),
    listSequences(supabase, campaignLead.campaign_id),
  ]);

  const sequence = sequences[0];
  const steps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];
  const targetStep = steps.find((step) => step.id === campaignLead.current_step_id);

  if (!targetStep) {
    const errorMessage = "current_step_id does not match any step in this sequence.";
    console.error("[send-worker] needs_review", { campaignLeadId: campaignLead.id, error: errorMessage });
    await updateCampaignLead(supabase, campaignLead.id, {
      status: "needs_review",
      last_error: errorMessage,
      locked_until: null,
    });
    return "needsReview";
  }

  // Defense in depth: claim_due_sends() already excludes suppressed
  // addresses at claim time, but a suppression (e.g. a concurrent
  // unsubscribe click — see lib/email/unsubscribe.ts) could land in the
  // window between that claim and this point. Re-check immediately before
  // any send_attempts row is created — the last moment to stop a send.
  const suppression = await getSuppression(supabase, campaign.user_id, lead.email);
  if (suppression) {
    console.error("[send-worker] skipped, suppressed since claim", {
      campaignLeadId: campaignLead.id,
      reason: suppression.reason,
    });
    await updateCampaignLead(supabase, campaignLead.id, {
      status: suppression.reason === "bounced" ? "bounced" : "unsubscribed",
      next_send_at: null,
      locked_until: null,
    });
    return "skipped";
  }

  // Send-time enforcement of the plan's monthly email volume cap — see
  // lib/billing/limits.ts's isWithinMonthlyEmailLimit. Checked here, not
  // just at campaign-create/edit time (assertWithinDailySendLimit only
  // bounds *configured* daily capacity), so a user genuinely cannot exceed
  // their plan's real monthly quota after a campaign is already running.
  // Never marks the lead failed/needs_review — the cap resets next
  // calendar month, so this pushes next_send_at out to then and releases
  // the claim lease, rather than leaving it to be immediately reclaimed
  // and re-checked on every cron tick for the rest of the month.
  if (!(await isWithinMonthlyEmailLimit(supabase, campaign.user_id))) {
    console.error("[send-worker] skipped, monthly email limit reached", {
      campaignLeadId: campaignLead.id,
      userId: campaign.user_id,
    });
    const now = new Date();
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    // A pending Send Now is dropped too: it was a request to send now, not
    // next month, and must not fire at 00:00 UTC regardless of the window.
    await updateCampaignLead(supabase, campaignLead.id, {
      next_send_at: nextMonthStart.toISOString(),
      locked_until: null,
      send_now_step_id: null,
    });
    return "skipped";
  }

  if ((await enforceSendingWindow(supabase, campaignLead, campaign.sending_window)) === "deferred") {
    return "skipped";
  }

  // Step-level idempotency claim — see lib/db/send-attempts.ts. Refusal
  // means either this step was already sent (self-heal below) or its
  // outcome is unknown (needs_review below); neither case calls the
  // provider.
  const claimedAttempt = await claimSendAttempt(supabase, campaignLead.id, targetStep.id);

  if (!claimedAttempt) {
    const existing = await getSendAttempt(supabase, campaignLead.id, targetStep.id);

    if (existing?.status === "sent") {
      // Already sent (e.g. a desynced manual reset) — advance scheduling
      // only. Deliberately not recordSendSuccess: that would insert a
      // second email_events row for a send that already happened and is
      // already correctly recorded.
      const schedule = computeNextSchedule({
        steps,
        currentStepId: targetStep.id,
        from: new Date(existing.resolved_at ?? existing.claimed_at),
        sendingWindow: campaign.sending_window,
      });

      await updateCampaignLead(supabase, campaignLead.id, {
        status: schedule.completed ? "completed" : "active",
        current_step_id: schedule.nextStepId,
        next_send_at: schedule.nextSendAt ? schedule.nextSendAt.toISOString() : null,
        locked_until: null,
      });

      return "skipped";
    }

    // Outcome unknown (existing row is 'pending', or missing entirely,
    // which shouldn't happen since claimSendAttempt just refused an
    // insert). Never resend automatically — this is the exact needs_review
    // gate the duplicate-send design depends on.
    console.error("[send-worker] needs_review", {
      campaignLeadId: campaignLead.id,
      sequenceStepId: targetStep.id,
      existingAttemptStatus: existing?.status ?? "missing",
    });
    await updateCampaignLead(supabase, campaignLead.id, {
      status: "needs_review",
      locked_until: null,
    });

    return "needsReview";
  }

  const unsubscribeUrl = buildUnsubscribeUrl(campaignLead.id);

  const mergeTagLead: MergeTagLead = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    email: lead.email,
    company: lead.company,
    title: lead.title,
    custom_fields: lead.custom_fields as Record<string, unknown> | null,
    unsubscribeUrl,
  };

  // The one canonical rendering path (lib/email/render-email.ts) — same
  // function a future preview feature and the rendering tests use, so
  // there's exactly one definition of how a template + lead becomes an
  // outgoing email. Produces both the HTML body and a plain-text body from
  // the same merge-tag-substituted source, per Phase render requirements.
  const rendered = renderEmailContent(targetStep.subject ?? "", targetStep.body ?? "", mergeTagLead);
  const subject = rendered.subject;
  let html = rendered.html;
  let text = rendered.text;

  // Non-fatal — the send still proceeds with the configured fallback (empty
  // string) in place of each unresolved tag. Logged so a template typo (an
  // unsupported tag name) or a lead missing expected data doesn't silently
  // ship blanks with nothing in the logs to explain why.
  if (rendered.missingTags.length > 0) {
    console.warn("[send-worker] merge tag(s) did not resolve to a value", {
      campaignLeadId: campaignLead.id,
      sequenceStepId: targetStep.id,
      missingTags: rendered.missingTags,
      unsupportedTags: rendered.unsupportedTags,
    });
  }

  // Every outgoing email needs a working unsubscribe mechanism (CAN-SPAM/
  // GDPR) regardless of whether the sequence step's own template remembered
  // to include {{unsubscribe_link}} — append a default footer whenever the
  // rendered body doesn't already contain the link, so compliance never
  // depends on the user remembering a merge tag. Checked against the
  // plain-text body: {{unsubscribe_link}} resolves to the raw URL there,
  // while the HTML body has it (and every other character) entity-escaped,
  // so a literal `&`-containing URL would never match against `html`.
  const settings = await getSettings(supabase, campaign.user_id);
  // Shared by both open and click tracking below — default true, same
  // fallback the Settings page itself uses (see app/(app)/settings/page.tsx).
  const trackingEnabled = settings?.tracking_enabled ?? true;

  // Batch 9B: click tracking. Runs BEFORE the unsubscribe footer is
  // appended below, on purpose: rewriting first means the footer's own
  // link (added after, using the raw, un-rewritten unsubscribeUrl) is
  // never subject to the rewriter at all — not "excluded by matching",
  // structurally never seen by it. excludeUrls still guards the case where
  // the sender's own template already includes {{unsubscribe_link}} (so
  // unsubscribeUrl is already present in `html` at this point, from
  // renderEmailContent) — that occurrence must also stay untracked.
  html = rewriteClickTrackingLinks(html, trackingEnabled, [unsubscribeUrl], {
    campaignId: campaignLead.campaign_id,
    campaignLeadId: campaignLead.id,
    leadId: campaignLead.lead_id,
    mailboxId: campaignLead.mailbox_id,
    sequenceStepId: targetStep.id,
  });

  if (!text.includes(unsubscribeUrl)) {
    const footerText = settings?.unsubscribe_text || DEFAULT_UNSUBSCRIBE_FOOTER_TEXT;
    html += `<hr/><p style="font-size:12px;color:#666;">${escapeHtml(footerText)} <a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
    text += `\n\n${footerText}: ${unsubscribeUrl}`;
  }

  // Batch 9A: open tracking. The toggle already exists and is documented
  // as inert until this batch. No Settings UI/schema change here.
  html = injectOpenTrackingPixel(html, trackingEnabled, {
    campaignId: campaignLead.campaign_id,
    campaignLeadId: campaignLead.id,
    leadId: campaignLead.lead_id,
    mailboxId: campaignLead.mailbox_id,
    sequenceStepId: targetStep.id,
  });

  const provider = getEmailProvider(mailbox);

  try {
    // Batch 3: resolved after everything above (suppression, monthly limit,
    // idempotency claim, rendering) and inside this try, before
    // provider.send() — same send, no separate path. If this step has
    // configured attachments and any of them can't be safely turned into a
    // provider payload, loadAttachmentsForSend throws before provider.send()
    // is ever called, and the catch block below handles it exactly like any
    // other send failure (classification, attempt cap, recordSendFailure).
    const attachments = await loadAttachmentsForSend(supabase, targetStep.id, campaign.user_id, {
      campaignLeadId: campaignLead.id,
      sequenceStepId: targetStep.id,
    });

    const threadingHeaders = await resolveThreadingHeaders(supabase, steps, targetStep, campaignLead.id);

    const result = await provider.send({
      from: { name: mailbox.display_name ?? undefined, email: mailbox.email },
      to: {
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined,
        email: lead.email,
      },
      subject,
      html,
      text,
      ...threadingHeaders,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    // Immediately followed by the success-recording call — nothing else
    // runs between provider.send() resolving and this, minimizing the
    // crash window the duplicate-send design accepts as irreducible.
    const schedule = computeNextSchedule({
      steps,
      currentStepId: targetStep.id,
      from: new Date(),
      sendingWindow: campaign.sending_window,
    });

    await recordSendSuccess(supabase, {
      sendAttemptId: claimedAttempt.id,
      campaignLeadId: campaignLead.id,
      campaignId: campaignLead.campaign_id,
      leadId: campaignLead.lead_id,
      mailboxId: campaignLead.mailbox_id,
      providerMessageId: result.providerMessageId,
      nextStatus: schedule.completed ? "completed" : "active",
      nextStepId: schedule.nextStepId,
      nextSendAt: schedule.nextSendAt ? schedule.nextSendAt.toISOString() : null,
    });

    return "sent";
  } catch (error) {
    const message = error instanceof EmailSendError ? error.message : "Unknown send error.";
    // Non-EmailSendError throws (a bug, not a classified provider failure)
    // default to "retry" rather than "failed" — a code defect shouldn't
    // permanently fail a lead any more than a network blip should; the
    // attempt cap below still bounds how many times that can happen.
    const classifiedOutcome = error instanceof EmailSendError ? error.outcome : "retry";

    // A "retry" classification only stays "retry" below the attempt cap —
    // past it, record_send_failure gets "failed" instead so campaign_leads
    // lands in a terminal state and claim_due_sends() (status = 'active'
    // only) naturally stops reclaiming it. "bounced" and "failed" pass
    // through unchanged; the cap doesn't apply to them.
    const belowCap = claimedAttempt.attempt_count < MAX_SEND_ATTEMPTS;
    const outcome: "retry" | "bounced" | "failed" =
      classifiedOutcome === "retry" && !belowCap ? "failed" : classifiedOutcome;

    console.error("[send-worker] send failed", {
      campaignLeadId: campaignLead.id,
      sequenceStepId: targetStep.id,
      outcome,
      attemptCount: claimedAttempt.attempt_count,
      error: message,
    });

    // Only "failed" (terminal — either an unretryable provider response, or
    // a "retry" that exhausted MAX_SEND_ATTEMPTS) is forwarded here. "retry"
    // is expected and self-heals on the next cron tick, and "bounced" is
    // normal business data already visible via deliverability/analytics —
    // forwarding every one of those to an external destination would make
    // the webhook too noisy to be useful for what actually needs attention.
    if (outcome === "failed") {
      await captureError({
        job: "send-emails",
        message,
        context: { campaignLeadId: campaignLead.id, sequenceStepId: targetStep.id, attemptCount: claimedAttempt.attempt_count },
      });
    }

    await recordSendFailure(supabase, {
      sendAttemptId: claimedAttempt.id,
      campaignLeadId: campaignLead.id,
      campaignId: campaignLead.campaign_id,
      leadId: campaignLead.lead_id,
      mailboxId: campaignLead.mailbox_id,
      errorMessage: message,
      outcome,
      ...(outcome === "retry" ? { nextSendAt: computeRetryDelay(claimedAttempt.attempt_count).toISOString() } : {}),
    });

    // The worker's own tally stays coarse-grained: every non-success outcome
    // this iteration — including a "retry" that'll be reclaimed later —
    // counts as "failed" for this run's summary.
    return "failed";
  }
}
