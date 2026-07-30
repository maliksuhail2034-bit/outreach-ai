import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// No userId parameter: ownership is derived from campaign_id via RLS (and
// the DB-level ownership-consistency trigger), not stored on this table.

export async function listCampaignLeads(supabase: Client, campaignId: string, options?: { status?: string }) {
  let query = supabase
    .from("campaign_leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCampaignLead(supabase: Client, id: string) {
  const result = await supabase.from("campaign_leads").select("*").eq("id", id).single();
  return unwrap<Tables<"campaign_leads">>(result);
}

export async function addLeadToCampaign(supabase: Client, values: TablesInsert<"campaign_leads">) {
  const result = await supabase.from("campaign_leads").insert(values).select("*").single();
  return unwrap<Tables<"campaign_leads">>(result);
}

export async function updateCampaignLead(supabase: Client, id: string, values: TablesUpdate<"campaign_leads">) {
  const result = await supabase.from("campaign_leads").update(values).eq("id", id).select("*").single();
  return unwrap<Tables<"campaign_leads">>(result);
}

export async function removeCampaignLead(supabase: Client, id: string) {
  const { error } = await supabase.from("campaign_leads").delete().eq("id", id);
  if (error) throw error;
}

// Bulk-enrolls leads not already in the campaign (campaign_leads has a
// unique(campaign_id, lead_id) constraint as a DB-level backstop, but
// pre-filtering here gives an accurate inserted/skipped count for the UI
// instead of relying on parsing constraint-violation errors per row).
export async function addLeadsToCampaign(
  supabase: Client,
  campaignId: string,
  leadIds: string[],
  mailboxId: string | null,
) {
  const { data: existing, error: existingError } = await supabase
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", campaignId);
  if (existingError) throw existingError;

  const alreadyEnrolled = new Set(existing.map((row) => row.lead_id));
  const toInsert = leadIds
    .filter((leadId) => !alreadyEnrolled.has(leadId))
    .map((leadId) => ({ campaign_id: campaignId, lead_id: leadId, mailbox_id: mailboxId }));

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: leadIds.length, rows: [] as Tables<"campaign_leads">[] };
  }

  // .select("*") on the same insert (no extra query) so callers can
  // schedule each newly-enrolled row without a second round-trip — see
  // scheduleOnEnrollment in app/(app)/campaigns/[campaignId]/actions.ts.
  const { data, error } = await supabase.from("campaign_leads").insert(toInsert).select("*");
  if (error) throw error;

  return { inserted: toInsert.length, skipped: leadIds.length - toInsert.length, rows: data ?? [] };
}

// Reply-tracking helper — campaign_leads has a unique(campaign_id, lead_id)
// constraint, so a header-based reply match (which lands on an
// email_events row carrying campaign_id + lead_id, not a campaign_lead id
// directly) can resolve the specific enrollment via this lookup.
export async function getCampaignLeadByCampaignAndLead(supabase: Client, campaignId: string, leadId: string) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Reply-tracking fallback-matching helper (see lib/email/reply-worker.ts) —
// bounded to a specific mailbox and a specific set of candidate lead ids
// (already resolved by From-address), so the caller can require an exact
// single match before treating it as attributable.
export async function listActiveCampaignLeadsForMailbox(supabase: Client, mailboxId: string, leadIds: string[]) {
  if (leadIds.length === 0) return [];
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("status", "active")
    .eq("mailbox_id", mailboxId)
    .in("lead_id", leadIds);
  if (error) throw error;
  return data;
}

// Wraps claim_due_sends() (supabase/migrations/20260730100020_claim_due_sends.sql).
// Must be called with lib/supabase/admin.ts — same carve-out as
// recordEmailEvent/getMailboxCredentials: privileged, no user in the loop.
// Locking/eligibility/daily-limit logic all lives in the RPC itself; this
// is a thin wrapper only.
export async function claimDueSends(supabase: Client, limit = 25) {
  const { data, error } = await supabase.rpc("claim_due_sends", { p_limit: limit });
  if (error) throw error;
  return data;
}
