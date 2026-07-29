import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

const DEFAULT_LIST_LIMIT = 200;

// No userId parameter: ownership is derived from campaign_id via RLS.

export async function listEmailEvents(
  supabase: Client,
  campaignId: string,
  options?: { leadId?: string; eventType?: string; limit?: number },
) {
  let query = supabase
    .from("email_events")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? DEFAULT_LIST_LIMIT);

  if (options?.leadId) {
    query = query.eq("lead_id", options.leadId);
  }
  if (options?.eventType) {
    query = query.eq("event_type", options.eventType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Typically called from the sending worker or a provider webhook handler
// with the admin client (lib/supabase/admin.ts), since events are usually
// recorded by a trusted backend process rather than an interactive user.
export async function recordEmailEvent(supabase: Client, values: TablesInsert<"email_events">) {
  const result = await supabase.from("email_events").insert(values).select("*").single();
  return unwrap<Tables<"email_events">>(result);
}
