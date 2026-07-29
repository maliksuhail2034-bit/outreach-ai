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
