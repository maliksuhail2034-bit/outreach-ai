"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { addLeadsToCampaign, addLeadToCampaign, getCampaign, listLeads, removeCampaignLead, updateCampaignLead } from "@/lib/db";
import { campaignLeadSchema, type CampaignLeadInput } from "@/lib/validations/campaign-leads";

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
