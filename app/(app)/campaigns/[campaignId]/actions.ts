"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addLeadsToCampaign,
  addLeadToCampaign,
  createSequenceStep,
  deleteSequenceStep,
  getCampaign,
  getOrCreateDefaultSequence,
  listLeads,
  listSequenceSteps,
  removeCampaignLead,
  swapSequenceStepOrder,
  updateCampaignLead,
  updateSequenceStep,
} from "@/lib/db";
import { campaignLeadSchema, type CampaignLeadInput } from "@/lib/validations/campaign-leads";
import { sequenceStepSchema, type SequenceStepInput } from "@/lib/validations/sequence-steps";

// Server Functions are reachable directly via POST regardless of which UI
// calls them. campaign_leads has no user_id column — ownership flows through
// campaign_id — so getCampaign(userId, campaignId) doubles as the ownership
// check: it throws if this campaign isn't the caller's before any mutation
// touches campaign_leads.

export async function enrollLeadAction(campaignId: string, leadId: string, mailboxId?: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
  const effectiveMailboxId = mailboxId ? mailboxId : campaign.default_mailbox_id;

  await addLeadToCampaign(supabase, {
    campaign_id: campaignId,
    lead_id: leadId,
    mailbox_id: effectiveMailboxId,
  });

  revalidatePath(`/campaigns/${campaignId}`);
}

export async function enrollLeadListAction(campaignId: string, listId: string, mailboxId?: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const campaign = await getCampaign(supabase, user.id, campaignId);
  const effectiveMailboxId = mailboxId ? mailboxId : campaign.default_mailbox_id;

  const leads = await listLeads(supabase, user.id, { listId, limit: 10000 });
  const leadIds = (leads ?? []).map((lead) => lead.id);

  const result = await addLeadsToCampaign(supabase, campaignId, leadIds, effectiveMailboxId);

  revalidatePath(`/campaigns/${campaignId}`);
  return result;
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
