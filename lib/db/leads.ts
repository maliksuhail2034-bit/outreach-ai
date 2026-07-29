import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

const DEFAULT_LIST_LIMIT = 100;

export async function listLeads(
  supabase: Client,
  userId: string,
  options?: { listId?: string; limit?: number },
) {
  let query = supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? DEFAULT_LIST_LIMIT);

  if (options?.listId) {
    query = query.eq("list_id", options.listId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function countLeads(supabase: Client, userId: string) {
  const { count, error } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

export async function getLead(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("leads").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"leads">>(result);
}

export async function createLead(supabase: Client, values: TablesInsert<"leads">) {
  const result = await supabase.from("leads").insert(values).select("*").single();
  return unwrap<Tables<"leads">>(result);
}

export async function updateLead(supabase: Client, userId: string, id: string, values: TablesUpdate<"leads">) {
  const result = await supabase
    .from("leads")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"leads">>(result);
}

export async function deleteLead(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("leads").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function deleteLeads(supabase: Client, userId: string, ids: string[]) {
  const { error } = await supabase.from("leads").delete().eq("user_id", userId).in("id", ids);
  if (error) throw error;
}

// Deletes every lead for the user, not just the ones currently loaded in the
// UI (listLeads caps at DEFAULT_LIST_LIMIT) — scoped by user_id alone rather
// than an id list.
export async function deleteAllLeads(supabase: Client, userId: string) {
  const { error } = await supabase.from("leads").delete().eq("user_id", userId);
  if (error) throw error;
}
