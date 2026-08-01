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
  createSequenceStep,
  deleteLead,
  deleteSequenceStep,
  getCampaign,
  getCampaignLead,
  getLead,
  getOrCreateDefaultSequence,
  getSendAttempt,
  getSuppressedEmails,
  listCampaignLeads,
  listDomains,
  listLeads,
  listMailboxes,
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
import { campaignLeadSchema, type CampaignLeadInput } from "@/lib/validations/campaign-leads";
import { sequenceStepSchema, type SequenceStepInput } from "@/lib/validations/sequence-steps";

// Server Functions are reachable directly via POST regardless of which UI
// calls them. campaign_leads has no user_id column — ownership flows through
// campaign_id — so getCampaign(userId, campaignId) doubles as the ownership
// check: it throws if this campaign isn't the caller's before any mutation
// touches campaign_leads.

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

// Validated draft -> active transition. Unlike the raw status field on
// CampaignForm/updateCampaignAction, this is the only path that (a) checks
// the campaign is actually ready to send and (b) schedules every lead
// enrolled while the campaign was still draft — scheduleOnEnrollment above
// only ever acts on leads enrolled after the campaign is already active, so
// without this, leads enrolled during setup would stay unscheduled forever.
export async function launchCampaignAction(campaignId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
  if (campaign.status !== "draft") {
    throw new Error("This campaign has already been launched.");
  }

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
    throw new Error(readiness.errors.join(" "));
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
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
  if (campaign.status !== "active") {
    throw new Error("Only a running campaign can be paused.");
  }

  await updateCampaign(supabase, user.id, campaignId, { status: "paused" });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function resumeCampaignAction(campaignId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
  if (campaign.status !== "paused") {
    throw new Error("Only a paused campaign can be resumed.");
  }

  await updateCampaign(supabase, user.id, campaignId, { status: "active" });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
}

// Stopping is terminal (unlike pausing): every lead still waiting in the
// pipeline is cancelled rather than left scheduled, so nothing resumes
// sending if the campaign's status is ever changed back to 'active' through
// the raw status editor on CampaignForm. Reuses the 'cancelled' status
// added in Phase 2D specifically for "deliberately stopped, not completed
// or failed" — see 20260804100000_sending_limits.sql.
export async function stopCampaignAction(campaignId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
  if (campaign.status !== "active" && campaign.status !== "paused") {
    throw new Error("Only a running or paused campaign can be stopped.");
  }

  await cancelActiveCampaignLeads(supabase, campaignId);
  await updateCampaign(supabase, user.id, campaignId, { status: "completed" });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
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
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);

  if (!confirmSuppressed) {
    const lead = await getLead(supabase, user.id, leadId);
    const suppressed = await getSuppressedEmails(supabase, user.id, [lead.email]);
    const reason = suppressed.get(lead.email);
    if (reason) {
      throw new Error(`This lead is suppressed (${reason}). Confirm to enroll anyway.`);
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
}

export async function enrollLeadListAction(
  campaignId: string,
  listId: string,
  mailboxId?: string,
  confirmSuppressed = false,
) {
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
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
      throw new Error(
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

  await createSequenceStep(supabase, {
    sequence_id: sequence.id,
    day_delay: parsed.dayDelay,
    subject: parsed.subject || null,
    body: parsed.body || null,
    step_order: nextOrder,
  });

  revalidatePath(`/campaigns/${campaignId}`);
}

export async function updateSequenceStepAction(campaignId: string, stepId: string, input: SequenceStepInput) {
  const parsed = sequenceStepSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);

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
  const user = await requireUser();
  const supabase = await createClient();

  await getCampaign(supabase, user.id, campaignId);

  const campaignLead = await getCampaignLead(supabase, campaignLeadId);
  if (campaignLead.status !== "needs_review" && campaignLead.status !== "failed") {
    throw new Error("This lead isn't awaiting review.");
  }
  if (!campaignLead.current_step_id) {
    throw new Error("This lead has no send attempt to resolve.");
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
}
