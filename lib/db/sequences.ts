import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// No userId parameter: ownership is derived from campaign_id via RLS.

export async function listSequences(supabase: Client, campaignId: string) {
  const { data, error } = await supabase
    .from("sequences")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getSequence(supabase: Client, id: string) {
  const result = await supabase.from("sequences").select("*").eq("id", id).single();
  return unwrap<Tables<"sequences">>(result);
}

export async function createSequence(supabase: Client, values: TablesInsert<"sequences">) {
  const result = await supabase.from("sequences").insert(values).select("*").single();
  return unwrap<Tables<"sequences">>(result);
}

export async function updateSequence(supabase: Client, id: string, values: TablesUpdate<"sequences">) {
  const result = await supabase.from("sequences").update(values).eq("id", id).select("*").single();
  return unwrap<Tables<"sequences">>(result);
}

export async function deleteSequence(supabase: Client, id: string) {
  const { error } = await supabase.from("sequences").delete().eq("id", id);
  if (error) throw error;
}
