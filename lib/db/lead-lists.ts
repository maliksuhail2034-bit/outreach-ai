import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function listLeadLists(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("lead_lists")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getLeadList(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("lead_lists").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"lead_lists">>(result);
}

export async function createLeadList(supabase: Client, values: TablesInsert<"lead_lists">) {
  const result = await supabase.from("lead_lists").insert(values).select("*").single();
  return unwrap<Tables<"lead_lists">>(result);
}

export async function updateLeadList(
  supabase: Client,
  userId: string,
  id: string,
  values: TablesUpdate<"lead_lists">,
) {
  const result = await supabase
    .from("lead_lists")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"lead_lists">>(result);
}

export async function deleteLeadList(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("lead_lists").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function countLeadsInList(supabase: Client, userId: string, listId: string) {
  const { count, error } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("list_id", listId);
  if (error) throw error;
  return count ?? 0;
}
