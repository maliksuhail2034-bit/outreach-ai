import { createAdminClient } from "@/lib/supabase/admin";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import {
  claimDueSends,
  claimSendAttempt,
  getCampaignById,
  getLeadById,
  getMailboxCredentials,
  getSendAttempt,
  getSettings,
  getSuppression,
  listSequenceSteps,
  listSequences,
  recordSendFailure,
  recordSendSuccess,
  updateCampaignLead,
} from "@/lib/db";
import { getEmailProvider } from "./get-provider";
import { EmailSendError } from "./provider";
import { renderMergeTags, type MergeTagLead } from "./merge-tags";
import { computeNextSchedule, computeRetryDelay } from "./scheduling";
import { buildUnsubscribeUrl } from "./unsubscribe-token";
import { captureError } from "@/lib/monitoring/error-tracking";

const DEFAULT_UNSUBSCRIBE_FOOTER_TEXT = "Don't want to receive these emails?";

const DEFAULT_CLAIM_LIMIT = 25;

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

type ProcessOutcome = "sent" | "failed" | "needsReview" | "skipped";

// Orchestration only: every step below delegates to a helper already built
// in earlier tasks (claiming, scheduling math, merge tags, provider send,
// ledger writes) — this file contains no scheduling, merge-tag, or
// duplicate-send-prevention logic of its own.
export async function runSendWorker(limit = DEFAULT_CLAIM_LIMIT): Promise<SendWorkerSummary> {
  const supabase = createAdminClient();

  const claimed = await claimDueSends(supabase, limit);
  const summary: SendWorkerSummary = { claimed: claimed.length, sent: 0, failed: 0, needsReview: 0, skipped: 0 };

  for (const campaignLead of claimed) {
    const outcome = await processCampaignLead(supabase, campaignLead);
    summary[outcome] += 1;
  }

  return summary;
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

  const subject = renderMergeTags(targetStep.subject ?? "", mergeTagLead).text;
  let body = renderMergeTags(targetStep.body ?? "", mergeTagLead, { escapeHtml: true }).text;

  // Every outgoing email needs a working unsubscribe mechanism (CAN-SPAM/
  // GDPR) regardless of whether the sequence step's own template remembered
  // to include {{unsubscribe_link}} — append a default footer whenever the
  // rendered body doesn't already contain the link, so compliance never
  // depends on the user remembering a merge tag.
  if (!body.includes(unsubscribeUrl)) {
    const settings = await getSettings(supabase, campaign.user_id);
    const footerText = settings?.unsubscribe_text || DEFAULT_UNSUBSCRIBE_FOOTER_TEXT;
    body += `<hr/><p style="font-size:12px;color:#666;">${footerText} <a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
  }

  const provider = getEmailProvider(mailbox);

  try {
    const result = await provider.send({
      from: { name: mailbox.display_name ?? undefined, email: mailbox.email },
      to: {
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined,
        email: lead.email,
      },
      subject,
      html: body,
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
