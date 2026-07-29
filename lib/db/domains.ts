import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function listDomains(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("domains")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getDomain(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("domains").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"domains">>(result);
}

export async function createDomain(supabase: Client, values: TablesInsert<"domains">) {
  const result = await supabase.from("domains").insert(values).select("*").single();
  return unwrap<Tables<"domains">>(result);
}

export async function updateDomain(supabase: Client, userId: string, id: string, values: TablesUpdate<"domains">) {
  const result = await supabase
    .from("domains")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"domains">>(result);
}

export async function deleteDomain(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("domains").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}
