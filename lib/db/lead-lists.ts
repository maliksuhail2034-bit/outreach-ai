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

export type LeadListWithCount = Tables<"lead_lists"> & { leadCount: number };

// listLeadLists plus each list's exact lead count, in one query: PostgREST's
// embedded count (leads(count)) is evaluated per list inside the same
// statement, so the Leads page no longer issues one count query per list.
// It counts the leads visible under the leads RLS policy (the caller's own),
// which are exactly the list's leads — leads_check_list_owner only lets a
// lead reference a list owned by the same user.
export async function listLeadListsWithCounts(supabase: Client, userId: string): Promise<LeadListWithCount[]> {
  const { data, error } = await supabase
    .from("lead_lists")
    .select("*, leads(count)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(({ leads, ...list }) => ({ ...list, leadCount: leads?.[0]?.count ?? 0 }));
}
