"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import {
  addLeadsToCampaign,
  addLeadToCampaign,
  cancelActiveCampaignLeads,
  createAttachment,
  createSequenceStep,
  deleteAttachments,
  deleteLead,
  deleteSequenceStep,
  getAttachment,
  getCampaign,
  getCampaignLead,
  getLead,
  getOrCreateDefaultSequence,
  getSendAttempt,
  getSequence,
  getSequenceStep,
  getSuppressedEmails,
  getUserOrganization,
  linkAttachmentsToStep,
  listCampaignLeads,
  listDomains,
  listLeads,
  listMailboxes,
  listOwnedAttachmentsByIds,
  listSequences,
  listSequenceSteps,
  removeCampaignLead,
  resolveSendAttemptManually,
  swapSequenceStepOrder,
  updateCampaign,
  updateCampaignLead,
  updateSequenceStep,
} from "@/lib/db";
import { computeNextSchedule } from "@/lib/email/scheduling";
import { checkCampaignReadiness, resolveLeadMailboxId } from "@/lib/campaigns/readiness";
import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENTS_PER_STEP,
  MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP,
  buildAttachmentStoragePath,
  formatBytes,
  sanitizeAttachmentFileName,
  validateAttachmentBytes,
} from "@/lib/email/attachment-validation";
import { campaignLeadSchema, type CampaignLeadInput } from "@/lib/validations/campaign-leads";
import { sequenceStepSchema, type SequenceStepInput } from "@/lib/validations/sequence-steps";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";

// Server Functions are reachable directly via POST regardless of which UI
// calls them. campaign_leads has no user_id column — ownership flows through
// campaign_id — so getCampaign(userId, campaignId) doubles as the ownership
// check: it throws if this campaign isn't the caller's before any mutation
// touches campaign_leads.

// Marks a message this file has already deliberately written for the user
// (a business-rule/validation failure, e.g. "Only a running campaign can be
// paused.") — never wraps a raw DB/PostgREST error, which unwrap() (see
// lib/db/shared.ts) throws as a plain Error/PostgrestError instead. Client
// components in this campaign's UI (enroll-dialog.tsx, campaign-lead-table.tsx,
// campaign-execution-controls.tsx, campaign-review-step.tsx) show a caught
// error's message directly via toast — see runUserFacing below for how an
// unclassified error is kept from reaching them.
class UserFacingError extends Error {}

// Wraps the exported actions below that a client component displays
// error.message from. Only errors this file has explicitly classified as
// safe (UserFacingError, RateLimitError — both purpose-written, no DB/
// infrastructure detail) pass through with their message intact; anything
// else (a raw PostgrestError from unwrap(), an unexpected bug) is logged in
// full here — server-side only — and replaced with one generic message
// before it can reach the browser.
async function runUserFacing<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof UserFacingError || error instanceof RateLimitError) {
      throw error;
    }
    console.error("[campaigns] unexpected error", error);
    throw new Error("Something went wrong. Try again.");
  }
}

// Computes and persists the first scheduled send for a freshly-enrolled
// campaign_lead — reuses computeNextSchedule (lib/email/scheduling.ts) for
// the actual math and updateCampaignLead (lib/db/campaign-leads.ts) for the
// write, so this is orchestration only, not a second scheduling algorithm.
// Only acts when the campaign is already active and has at least one
// sequence step; otherwise the lead stays exactly as inserted ('pending',
// no current_step_id/next_send_at) until something schedules it later.
async function scheduleOnEnrollment(
  supabase: Client,
  campaign: Tables<"campaigns">,
  campaignLead: Tables<"campaign_leads">,
  steps: Tables<"sequence_steps">[],
) {
  if (campaign.status !== "active" || steps.length === 0) return;

  const schedule = computeNextSchedule({
    steps,
    currentStepId: null,
    from: new Date(campaignLead.enrolled_at),
    sendingWindow: campaign.sending_window,
  });

  await updateCampaignLead(supabase, campaignLead.id, {
    current_step_id: schedule.nextStepId,
    next_send_at: schedule.nextSendAt ? schedule.nextSendAt.toISOString() : null,
    status: schedule.completed ? "completed" : "active",
  });
}

// Loads the campaign's one implicit sequence and its steps, for scheduling
// newly-enrolled leads. Returns an empty array if no sequence/steps exist
// yet — scheduleOnEnrollment treats that as "nothing to schedule."
async function loadSequenceSteps(supabase: Client, campaignId: string) {
  const sequences = await listSequences(supabase, campaignId);
  const sequence = sequences[0];
  return sequence ? listSequenceSteps(supabase, sequence.id) : Promise.resolve([]);
}

// Defense in depth alongside RLS (campaign_leads_update_own/_delete_own's
// policy and check_campaign_lead_owner() both already re-derive ownership
// from the row's real campaign_id — see
// 20260728100070_campaign_leads.sql) — this is the app-level mirror of that
// check, closing the gap where getCampaign(userId, campaignId) verifies the
// caller owns *a* campaign but never that the mutated campaignLeadId
// belongs to *that* campaign. campaign_leads has campaign_id directly, so
// this is a plain equality check on a row already fetched, not another
// query.
function assertCampaignLeadInCampaign(campaignLead: Tables<"campaign_leads">, campaignId: string) {
  if (campaignLead.campaign_id !== campaignId) {
    throw new UserFacingError("This lead does not belong to this campaign.");
  }
}

// Same defense-in-depth reasoning as assertCampaignLeadInCampaign, one hop
// further: sequence_steps has no campaign_id column of its own, only
// sequence_id, so closing this requires one extra lookup (the sequence's
// own campaign_id) rather than a plain equality check on an already-fetched
// row.
async function assertSequenceInCampaign(supabase: Client, sequenceId: string, campaignId: string) {
  const sequence = await getSequence(supabase, sequenceId);
  if (sequence.campaign_id !== campaignId) {
    throw new UserFacingError("This step does not belong to this campaign.");
  }
}

// Validated draft -> active transition. Unlike the raw status field on
// CampaignForm/updateCampaignAction, this is the only path that (a) checks
// the campaign is actually ready to send and (b) schedules every lead
// enrolled while the campaign was still draft — scheduleOnEnrollment above
// only ever acts on leads enrolled after the campaign is already active, so
// without this, leads enrolled during setup would stay unscheduled forever.
export async function launchCampaignAction(campaignId: string) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    if (campaign.status !== "draft") {
      throw new UserFacingError("This campaign has already been launched.");
    }

    const organization = await getUserOrganization(supabase, user);
    await checkRateLimit("campaign:launch", organization.id);

    const steps = await loadSequenceSteps(supabase, campaignId);
    const leads = await listCampaignLeads(supabase, campaignId);
    const mailboxes = await listMailboxes(supabase, user.id);
    const domains = await listDomains(supabase, user.id);

    // Same check the campaign detail/wizard UI runs to show readiness ahead
    // of the click (see lib/campaigns/readiness.ts) — re-run here because
    // Server Functions are reachable directly via POST regardless of what the
    // UI already validated. Only `errors` block the launch; `warnings` (no
    // sending domain, mailbox limits) are advisory and don't stop it — see
    // that module for why.
    const readiness = checkCampaignReadiness({
      campaign,
      campaignLeads: leads,
      sequenceStepCount: steps.length,
      mailboxes,
      domainCount: (domains ?? []).length,
    });
    if (!readiness.ready) {
      throw new UserFacingError(readiness.errors.join(" "));
    }

    const activatedCampaign = { ...campaign, status: "active" as const };
    await updateCampaign(supabase, user.id, campaignId, { status: "active" });

    for (const lead of leads) {
      if (lead.status !== "pending") continue;

      // Leads enrolled while the campaign was still draft (the wizard's Leads
      // step runs before its Mailbox step) can have mailbox_id null even
      // though campaign.default_mailbox_id now resolves them — enrollLeadAction/
      // enrollLeadListAction only ever resolve the default at the moment of
      // enrollment, they never retroactively backfill it. claim_due_sends()
      // requires mailbox_id is not null, so without this a "resolvable" lead
      // would silently never be picked up by the send worker.
      let scheduledLead = lead;
      if (!lead.mailbox_id) {
        scheduledLead = await updateCampaignLead(supabase, lead.id, {
          mailbox_id: resolveLeadMailboxId(lead, campaign),
        });
      }

      await scheduleOnEnrollment(supabase, activatedCampaign, scheduledLead, steps);
    }

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
  });
}

// --- Execution controls (Phase 2E) -----------------------------------------
// Pause/resume/stop, alongside the launch action above. All three are thin:
// claim_due_sends() already only ever selects campaigns.status = 'active'
// (see 20260730100020_claim_due_sends.sql), so pausing/stopping needs no
// change to campaign_leads to take effect immediately — new claims simply
// stop. Resuming needs no change either: already-scheduled leads
// (status = 'active', next_send_at set) start being claimed again as soon
// as the campaign is active.

export async function pauseCampaignAction(campaignId: string) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    if (campaign.status !== "active") {
      throw new UserFacingError("Only a running campaign can be paused.");
    }

    await updateCampaign(supabase, user.id, campaignId, { status: "paused" });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
  });
}

export async function resumeCampaignAction(campaignId: string) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    if (campaign.status !== "paused") {
      throw new UserFacingError("Only a paused campaign can be resumed.");
    }

    await updateCampaign(supabase, user.id, campaignId, { status: "active" });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
  });
}

// Stopping is terminal (unlike pausing): every lead still waiting in the
// pipeline is cancelled rather than left scheduled, so nothing resumes
// sending if the campaign's status is ever changed back to 'active' through
// the raw status editor on CampaignForm. Reuses the 'cancelled' status
// added in Phase 2D specifically for "deliberately stopped, not completed
// or failed" — see 20260804100000_sending_limits.sql.
export async function stopCampaignAction(campaignId: string) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    if (campaign.status !== "active" && campaign.status !== "paused") {
      throw new UserFacingError("Only a running or paused campaign can be stopped.");
    }

    await cancelActiveCampaignLeads(supabase, campaignId);
    await updateCampaign(supabase, user.id, campaignId, { status: "completed" });

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
  });
}

// Re-enrolling a suppressed (bounced/unsubscribed) address won't actually
// send anything — claim_due_sends() and send-worker.ts's own suppression
// re-check both already block it — but silently allowing the enrollment
// anyway is confusing UX for something that looks like a deliberate
// re-engagement attempt. Require an explicit confirmSuppressed=true from the
// UI (see EnrollDialog's warning + checkbox) rather than gating only in the
// client, since Server Functions must re-check independently of the caller.
export async function enrollLeadAction(
  campaignId: string,
  leadId: string,
  mailboxId?: string,
  confirmSuppressed = false,
) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    const organization = await getUserOrganization(supabase, user);
    await checkRateLimit("campaign:enroll", organization.id);

    if (!confirmSuppressed) {
      const lead = await getLead(supabase, user.id, leadId);
      const suppressed = await getSuppressedEmails(supabase, user.id, [lead.email]);
      const reason = suppressed.get(lead.email);
      if (reason) {
        throw new UserFacingError(`This lead is suppressed (${reason}). Confirm to enroll anyway.`);
      }
    }

    const effectiveMailboxId = mailboxId ? mailboxId : campaign.default_mailbox_id;

    const campaignLead = await addLeadToCampaign(supabase, {
      campaign_id: campaignId,
      lead_id: leadId,
      mailbox_id: effectiveMailboxId,
    });

    const steps = await loadSequenceSteps(supabase, campaignId);
    await scheduleOnEnrollment(supabase, campaign, campaignLead, steps);

    revalidatePath(`/campaigns/${campaignId}`);
  });
}

export async function enrollLeadListAction(
  campaignId: string,
  listId: string,
  mailboxId?: string,
  confirmSuppressed = false,
) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    const organization = await getUserOrganization(supabase, user);
    await checkRateLimit("campaign:enroll", organization.id);
    const effectiveMailboxId = mailboxId ? mailboxId : campaign.default_mailbox_id;

    const leads = await listLeads(supabase, user.id, { listId, limit: 10000 });
    const leadRows = leads ?? [];

    if (!confirmSuppressed) {
      const suppressed = await getSuppressedEmails(
        supabase,
        user.id,
        leadRows.map((lead) => lead.email),
      );
      const suppressedCount = leadRows.filter((lead) => suppressed.has(lead.email)).length;
      if (suppressedCount > 0) {
        throw new UserFacingError(
          `${suppressedCount} lead${suppressedCount === 1 ? "" : "s"} in this list ${suppressedCount === 1 ? "is" : "are"} suppressed (bounced/unsubscribed). Confirm to enroll anyway.`,
        );
      }
    }

    const leadIds = leadRows.map((lead) => lead.id);
    const result = await addLeadsToCampaign(supabase, campaignId, leadIds, effectiveMailboxId);

    const steps = await loadSequenceSteps(supabase, campaignId);
    for (const campaignLead of result.rows) {
      await scheduleOnEnrollment(supabase, campaign, campaignLead, steps);
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return { inserted: result.inserted, skipped: result.skipped };
  });
}

export async function updateCampaignLeadAction(
  campaignId: string,
  campaignLeadId: string,
  input: CampaignLeadInput,
) {
  const parsed = campaignLeadSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);
  const campaignLead = await getCampaignLead(supabase, campaignLeadId);
  assertCampaignLeadInCampaign(campaignLead, campaignId);

  await updateCampaignLead(supabase, campaignLeadId, {
    mailbox_id: parsed.mailboxId ? parsed.mailboxId : null,
    status: parsed.status,
  });

  revalidatePath(`/campaigns/${campaignId}`);
}

export async function removeCampaignLeadAction(campaignId: string, campaignLeadId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);
  const campaignLead = await getCampaignLead(supabase, campaignLeadId);
  assertCampaignLeadInCampaign(campaignLead, campaignId);

  await removeCampaignLead(supabase, campaignLeadId);

  revalidatePath(`/campaigns/${campaignId}`);
}

// Permanently deletes the lead itself, not just this enrollment — every
// campaign_leads/email_events/send_attempts row referencing it is removed
// via "on delete cascade" (see the leads/campaign_leads/email_events/
// send_attempts migrations), so this can't leave orphaned rows behind.
// Deliberately global: a lead deleted from inside one campaign's view is
// gone from every campaign, matching what "permanently delete" implies.
// The lead's suppressions row (keyed by email, not lead_id) is untouched —
// suppression must survive the lead record so the address stays blocked if
// it's ever re-imported.
export async function deleteLeadPermanentlyAction(campaignId: string, leadId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);

  await deleteLead(supabase, user.id, leadId);

  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

// Same ownership pattern as the campaign_leads actions above: sequence_steps
// has no campaign_id column, so getCampaign(userId, campaignId) is the
// explicit ownership check, backed by RLS on sequences/sequence_steps.

export async function createSequenceStepAction(campaignId: string, input: SequenceStepInput) {
  const parsed = sequenceStepSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);
  const sequence = await getOrCreateDefaultSequence(supabase, campaignId);
  const steps = await listSequenceSteps(supabase, sequence.id);
  const nextOrder = steps.length > 0 ? Math.max(...steps.map((step) => step.step_order)) + 1 : 0;

  // Returns the new step's id (Batch 3) so the composer can link any
  // just-uploaded attachments to it right after — a brand-new step has no
  // id until this insert completes, and attachments are uploaded before
  // Save is even clicked (see linkAttachmentsToStepAction).
  const step = await createSequenceStep(supabase, {
    sequence_id: sequence.id,
    day_delay: parsed.dayDelay,
    subject: parsed.subject || null,
    body: parsed.body || null,
    step_order: nextOrder,
  });

  revalidatePath(`/campaigns/${campaignId}`);

  return { id: step.id };
}

export async function updateSequenceStepAction(campaignId: string, stepId: string, input: SequenceStepInput) {
  const parsed = sequenceStepSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);
  const step = await getSequenceStep(supabase, stepId);
  await assertSequenceInCampaign(supabase, step.sequence_id, campaignId);

  await updateSequenceStep(supabase, stepId, {
    day_delay: parsed.dayDelay,
    subject: parsed.subject || null,
    body: parsed.body || null,
  });

  revalidatePath(`/campaigns/${campaignId}`);
}

export async function deleteSequenceStepAction(campaignId: string, stepId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);
  const step = await getSequenceStep(supabase, stepId);
  await assertSequenceInCampaign(supabase, step.sequence_id, campaignId);

  await deleteSequenceStep(supabase, stepId);

  revalidatePath(`/campaigns/${campaignId}`);
}

export async function moveSequenceStepAction(
  campaignId: string,
  sequenceId: string,
  stepId: string,
  direction: "up" | "down",
) {
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);
  await assertSequenceInCampaign(supabase, sequenceId, campaignId);

  const steps = await listSequenceSteps(supabase, sequenceId);
  const index = steps.findIndex((step) => step.id === stepId);
  if (index === -1) return;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= steps.length) return;

  await swapSequenceStepOrder(supabase, sequenceId, steps[index].id, steps[targetIndex].id);

  revalidatePath(`/campaigns/${campaignId}`);
}

// Manual crash recovery for a lead the send worker couldn't resolve on its
// own (needs_review) or gave up on (failed) — the function
// send_attempts.sql's RLS policy comment named but never implemented. Runs
// on the user-scoped client throughout (RLS is the real ownership boundary
// on both campaign_leads and send_attempts, same as every other action in
// this file), never the admin client.
export async function resolveSendAttemptAction(
  campaignId: string,
  campaignLeadId: string,
  action: "retry" | "dismiss",
) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    await getCampaign(supabase, user.id, campaignId);
    const organization = await getUserOrganization(supabase, user);
    await checkRateLimit("campaign:resolve_send_attempt", organization.id);

    const campaignLead = await getCampaignLead(supabase, campaignLeadId);
    assertCampaignLeadInCampaign(campaignLead, campaignId);
    if (campaignLead.status !== "needs_review" && campaignLead.status !== "failed") {
      throw new UserFacingError("This lead isn't awaiting review.");
    }
    if (!campaignLead.current_step_id) {
      throw new UserFacingError("This lead has no send attempt to resolve.");
    }

    const sendAttempt = await getSendAttempt(supabase, campaignLeadId, campaignLead.current_step_id);
    if (sendAttempt) {
      await resolveSendAttemptManually(
        supabase,
        sendAttempt.id,
        action === "retry" ? "Manually reset for retry." : "Manually dismissed.",
      );
    }

    if (action === "retry") {
      // Hand back to the existing pipeline rather than resending here directly
      // — claim_due_sends() re-checks mailbox status and suppression at claim
      // time, so this doesn't need to duplicate those checks.
      await updateCampaignLead(supabase, campaignLeadId, {
        status: "active",
        next_send_at: new Date().toISOString(),
        locked_until: null,
      });
    } else {
      await updateCampaignLead(supabase, campaignLeadId, { status: "failed" });
    }

    revalidatePath(`/campaigns/${campaignId}`);
  });
}

// --- Send Now (Batch 4) -----------------------------------------------------
// "Send now" for one enrolled lead's next pending step. Deliberately does
// NOT talk to the provider, claim a send_attempt, or otherwise short-circuit
// the real send path: it only pulls this one campaign_lead's next_send_at
// forward to "now," making it eligible for the very next claim_due_sends()
// tick — the exact same queue every scheduled send already goes through.
// Every existing safety check downstream is therefore untouched and still
// applies: mailbox daily/hourly/cooldown limits and campaign.status =
// 'active' (claim_due_sends(), see supabase/migrations/20260804100000_sending_limits.sql),
// suppression (processCampaignLead's getSuppression re-check, see
// lib/email/send-worker.ts), and send_attempts idempotency
// (claimSendAttempt). The only thing this bypasses is *waiting for the
// sending window* — which is the entire point of "now" instead of "at the
// next scheduled window," not a safety check.
//
// Only ever writes next_send_at. Never touches mailbox_id (mailbox-per-lead
// stickiness), status, or current_step_id (follow-up sequencing) — so this
// can't create a duplicate queue entry, move a lead to a different mailbox,
// or skip a step.
export async function sendNowAction(campaignId: string, campaignLeadId: string) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const campaign = await getCampaign(supabase, user.id, campaignId);
    const organization = await getUserOrganization(supabase, user);
    await checkRateLimit("campaign:send_now", organization.id);

    // Paused campaign protection: claim_due_sends() already only ever claims
    // for campaigns.status = 'active', so this alone would make a paused
    // campaign's "Send now" a silent no-op rather than an honest error —
    // reject it up front instead, matching "must not bypass paused campaign
    // protection."
    if (campaign.status !== "active") {
      throw new UserFacingError("Only an active campaign can send now.");
    }

    const campaignLead = await getCampaignLead(supabase, campaignLeadId);
    assertCampaignLeadInCampaign(campaignLead, campaignId);

    if (campaignLead.status !== "active") {
      throw new UserFacingError("This lead isn't currently active in the sequence.");
    }
    if (!campaignLead.current_step_id) {
      throw new UserFacingError("This lead has no pending step to send.");
    }
    if (!campaignLead.mailbox_id) {
      throw new UserFacingError("This lead has no assigned mailbox to send from.");
    }
    // Currently claimed by an in-flight send (claim_due_sends() sets
    // locked_until ~10 minutes out — see that function). Forcing next_send_at
    // now would race the worker that already has this row; reject instead of
    // risking two lanes touching the same lead.
    if (campaignLead.locked_until && new Date(campaignLead.locked_until) > new Date()) {
      throw new UserFacingError("This lead is already being sent — try again in a moment.");
    }

    await updateCampaignLead(supabase, campaignLeadId, {
      next_send_at: new Date().toISOString(),
    });

    revalidatePath(`/campaigns/${campaignId}`);
  });
}

// --- Attachments (Batch 3) --------------------------------------------------
// PDF/image files a sequence step sends alongside its HTML/plain-text body
// (lib/email/render-email.ts). Metadata lives in email_attachments
// (supabase/migrations/20260917100000_email_attachments.sql); file bytes
// live in the private "attachments" Storage bucket the same migration
// creates. Every action here runs on the session-scoped client — RLS is the
// real ownership boundary on both email_attachments and storage.objects,
// same as every other table in this file — with the same explicit
// app-level checks (ownership, limits) this file already layers on top of
// RLS everywhere else, since a Server Function is reachable directly by
// anyone who can POST to it regardless of what the composer UI already
// validated client-side.

// Uploaded before the owning sequence_step_id is known: a brand-new "Add
// step" dialog has no step id until Save. The returned row is linked to a
// step later, by linkAttachmentsToStepAction, once that step actually
// exists. Never trusts the browser's File.type or declared size — the real
// bytes are sniffed here regardless of what the upload claims (see
// lib/email/attachment-validation.ts's validateAttachmentBytes).
export async function uploadAttachmentAction(formData: FormData) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new UserFacingError("No file was provided.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateAttachmentBytes(bytes);
    if (!validation.ok) {
      throw new UserFacingError(validation.reason);
    }

    const safeName = sanitizeAttachmentFileName(file.name || "attachment");
    const storagePath = buildAttachmentStoragePath(user.id, safeName);

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, bytes, { contentType: validation.mimeType, upsert: false });
    if (uploadError) {
      console.error("[attachments] upload failed", uploadError);
      throw new UserFacingError("Couldn't upload this file. Try again.");
    }

    try {
      const attachment = await createAttachment(supabase, {
        user_id: user.id,
        sequence_step_id: null,
        file_name: safeName,
        mime_type: validation.mimeType,
        size_bytes: bytes.byteLength,
        storage_path: storagePath,
      });
      // Shaped to exactly what the composer renders — never the raw row —
      // per the Server Functions guide's "constrain return values."
      return {
        id: attachment.id,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        sizeBytes: attachment.size_bytes,
      };
    } catch (dbError) {
      // The DB row is the source of truth for "this attachment exists" — if
      // the insert fails, the object just uploaded would otherwise be an
      // orphaned file nothing ever references again. Best-effort: a cleanup
      // failure is only logged, so the real error (the DB failure) is what
      // reaches the caller.
      await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .remove([storagePath])
        .catch((cleanupError) => console.error("[attachments] rollback cleanup failed", cleanupError));
      throw dbError;
    }
  });
}

// Links a set of already-uploaded attachments (each still owned by the
// caller, verified below) to a saved sequence step. Called right after
// createSequenceStepAction/updateSequenceStepAction succeeds — see
// SequenceStepForm. Re-validates ownership and the count/size limits
// server-side rather than trusting whatever the client already checked:
// this Server Function is reachable directly via POST with any attachment
// ids at all, not just ones the composer UI actually uploaded for this step.
export async function linkAttachmentsToStepAction(campaignId: string, stepId: string, attachmentIds: string[]) {
  return runUserFacing(async () => {
    if (attachmentIds.length === 0) return;

    const user = await requireUser();
    const supabase = await createClient();

    await getCampaign(supabase, user.id, campaignId);
    const step = await getSequenceStep(supabase, stepId);
    await assertSequenceInCampaign(supabase, step.sequence_id, campaignId);

    const owned = await listOwnedAttachmentsByIds(supabase, user.id, attachmentIds);
    if (owned.length !== attachmentIds.length) {
      throw new UserFacingError("One or more attachments could not be found.");
    }
    if (owned.length > MAX_ATTACHMENTS_PER_STEP) {
      throw new UserFacingError(`A step can have at most ${MAX_ATTACHMENTS_PER_STEP} attachments.`);
    }
    const totalBytes = owned.reduce((sum, attachment) => sum + attachment.size_bytes, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP) {
      throw new UserFacingError(
        `These attachments total ${formatBytes(totalBytes)}, over the ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP)} limit per step.`,
      );
    }

    await linkAttachmentsToStep(supabase, user.id, attachmentIds, stepId);

    revalidatePath(`/campaigns/${campaignId}`);
  });
}

// Hard delete — both the storage object and the metadata row. Used for both
// an unlinked (never-saved) attachment and an already-linked one being
// removed from a saved step; ownership scoping is identical either way
// (RLS plus the explicit .eq("user_id", ...) getAttachment/deleteAttachments
// already carry — see lib/db/attachments.ts).
export async function removeAttachmentAction(attachmentId: string) {
  return runUserFacing(async () => {
    const user = await requireUser();
    const supabase = await createClient();

    const attachment = await getAttachment(supabase, user.id, attachmentId);

    const { error: storageError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([attachment.storage_path]);
    if (storageError) {
      // Logged, not thrown: the DB row is what the UI/send worker actually
      // treat as "this attachment exists" — a now-unreferenced object left
      // behind in a private bucket is a harmless leftover, and strictly
      // better than leaving the DB row (and the UI showing it as attached)
      // when the user explicitly asked to remove it.
      console.error("[attachments] storage removal failed", storageError);
    }

    await deleteAttachments(supabase, user.id, [attachmentId]);

    if (attachment.sequence_step_id) {
      const step = await getSequenceStep(supabase, attachment.sequence_step_id).catch(() => null);
      if (step) {
        const sequence = await getSequence(supabase, step.sequence_id).catch(() => null);
        if (sequence) revalidatePath(`/campaigns/${sequence.campaign_id}`);
      }
    }
  });
}

// Cleanup for the "uploaded a file, then closed the dialog without saving"
// case — see SequenceStepForm's unmount effect. Only ever removes rows that
// are (a) owned by the caller and (b) still unlinked
// (sequence_step_id is null): an id that got linked by a real save that
// raced with this call is left alone, never deleted out from under a saved
// step. Best-effort by design — a client that never calls this (e.g. the
// tab was closed rather than the dialog) simply leaves an unlinked
// attachment behind; see this batch's known limitations.
export async function discardUnlinkedAttachmentsAction(attachmentIds: string[]) {
  if (attachmentIds.length === 0) return;

  const user = await requireUser();
  const supabase = await createClient();

  const owned = await listOwnedAttachmentsByIds(supabase, user.id, attachmentIds);
  const unlinkedIds = owned.filter((attachment) => attachment.sequence_step_id === null).map((a) => a.id);
  if (unlinkedIds.length === 0) return;

  const paths = owned.filter((attachment) => unlinkedIds.includes(attachment.id)).map((a) => a.storage_path);
  await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(paths)
    .catch((error) => console.error("[attachments] discard cleanup failed", error));

  await deleteAttachments(supabase, user.id, unlinkedIds);
}
