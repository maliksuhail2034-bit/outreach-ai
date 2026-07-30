import type { Client } from "./shared";

// send_attempts is the idempotency ledger for the send pipeline (see
// supabase/migrations/20260730100030_send_attempts.sql). Every function here
// is a thin wrapper around an RPC that does its own atomicity/locking in
// Postgres — nothing here performs claiming logic itself. All are intended
// to be called from the sending worker (not built in this task) via
// lib/supabase/admin.ts, the same carve-out as claimDueSends.

export async function claimSendAttempt(supabase: Client, campaignLeadId: string, sequenceStepId: string) {
  const { data, error } = await supabase.rpc("claim_send_attempt", {
    p_campaign_lead_id: campaignLeadId,
    p_sequence_step_id: sequenceStepId,
  });
  if (error) throw error;
  // (campaign_lead_id, sequence_step_id) is unique, so this is 0 or 1 rows.
  return data?.[0] ?? null;
}

// Called when claimSendAttempt returns null, to tell apart "already sent"
// (self-heal: skip sending, advance scheduling) from "outcome unknown"
// (refuse: campaign_leads.status = 'needs_review'). The branching itself
// belongs to the worker, not this module.
export async function getSendAttempt(supabase: Client, campaignLeadId: string, sequenceStepId: string) {
  const { data, error } = await supabase
    .from("send_attempts")
    .select("*")
    .eq("campaign_lead_id", campaignLeadId)
    .eq("sequence_step_id", sequenceStepId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function recordSendSuccess(
  supabase: Client,
  params: {
    sendAttemptId: string;
    campaignLeadId: string;
    campaignId: string;
    leadId: string;
    mailboxId: string;
    providerMessageId: string;
    nextStatus: string;
    nextStepId: string | null;
    nextSendAt: string | null;
  },
) {
  const { error } = await supabase.rpc("record_send_success", {
    p_send_attempt_id: params.sendAttemptId,
    p_campaign_lead_id: params.campaignLeadId,
    p_campaign_id: params.campaignId,
    p_lead_id: params.leadId,
    p_mailbox_id: params.mailboxId,
    p_provider_message_id: params.providerMessageId,
    p_next_status: params.nextStatus,
    p_next_step_id: params.nextStepId ?? undefined,
    p_next_send_at: params.nextSendAt ?? undefined,
  });
  if (error) throw error;
}

// Dashboard-facing reads, unlike the functions above — these use the
// user-scoped server client (RLS via campaign_leads -> campaigns -> user_id,
// same as getSendAttempt), not the admin client.

export async function listSendAttempts(supabase: Client, limit = 10) {
  const { data, error } = await supabase
    .from("send_attempts")
    .select("*")
    .order("claimed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// status omitted counts all attempts regardless of outcome (e.g. "total
// emails attempted" for analytics), rather than requiring a second function.
export async function countSendAttemptsByStatus(supabase: Client, status?: string) {
  let query = supabase.from("send_attempts").select("*", { count: "exact", head: true });
  if (status) query = query.eq("status", status);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

// Analytics-only: per-campaign attempt/failure counts for the campaign
// performance table. send_attempts has no campaign_id column directly (only
// campaign_lead_id), so the caller resolves a campaign's lead ids first
// (e.g. via listCampaignLeads) and passes them here.
export async function listSendAttemptsForCampaignLeads(supabase: Client, campaignLeadIds: string[]) {
  if (campaignLeadIds.length === 0) return [];
  const { data, error } = await supabase.from("send_attempts").select("*").in("campaign_lead_id", campaignLeadIds);
  if (error) throw error;
  return data;
}

export async function recordSendFailure(
  supabase: Client,
  params: {
    sendAttemptId: string;
    campaignLeadId: string;
    campaignId: string;
    leadId: string;
    mailboxId: string;
    errorMessage: string;
    outcome: "retry" | "failed" | "bounced";
    nextSendAt?: string | null;
  },
) {
  const { error } = await supabase.rpc("record_send_failure", {
    p_send_attempt_id: params.sendAttemptId,
    p_campaign_lead_id: params.campaignLeadId,
    p_campaign_id: params.campaignId,
    p_lead_id: params.leadId,
    p_mailbox_id: params.mailboxId,
    p_error_message: params.errorMessage,
    p_outcome: params.outcome,
    p_next_send_at: params.nextSendAt ?? undefined,
  });
  if (error) throw error;
}
