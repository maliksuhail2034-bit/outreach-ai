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
  listSequenceSteps,
  listSequences,
  recordSendFailure,
  recordSendSuccess,
  updateCampaignLead,
} from "@/lib/db";
import { getEmailProvider } from "./get-provider";
import { EmailSendError } from "./provider";
import { renderMergeTags, type MergeTagLead } from "./merge-tags";
import { computeNextSchedule } from "./scheduling";

const DEFAULT_CLAIM_LIMIT = 25;

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
    await updateCampaignLead(supabase, campaignLead.id, {
      status: "needs_review",
      last_error: "Claimed with no current_step_id or mailbox_id.",
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
    await updateCampaignLead(supabase, campaignLead.id, {
      status: "needs_review",
      last_error: "current_step_id does not match any step in this sequence.",
      locked_until: null,
    });
    return "needsReview";
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
    await updateCampaignLead(supabase, campaignLead.id, {
      status: "needs_review",
      locked_until: null,
    });

    return "needsReview";
  }

  const mergeTagLead: MergeTagLead = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    email: lead.email,
    company: lead.company,
    title: lead.title,
    custom_fields: lead.custom_fields as Record<string, unknown> | null,
  };

  const subject = renderMergeTags(targetStep.subject ?? "", mergeTagLead).text;
  const body = renderMergeTags(targetStep.body ?? "", mergeTagLead).text;

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

    // Gap B (approved): every provider failure collapses to a terminal
    // 'failed' outcome this iteration — no retry/backoff, no bounce
    // classification. Revisit alongside provider-specific enhancements.
    await recordSendFailure(supabase, {
      sendAttemptId: claimedAttempt.id,
      campaignLeadId: campaignLead.id,
      campaignId: campaignLead.campaign_id,
      leadId: campaignLead.lead_id,
      mailboxId: campaignLead.mailbox_id,
      errorMessage: message,
      outcome: "failed",
    });

    return "failed";
  }
}
