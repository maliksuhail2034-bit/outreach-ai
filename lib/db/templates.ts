import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function listTemplates(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getTemplate(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("templates").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"templates">>(result);
}

export async function createTemplate(supabase: Client, values: TablesInsert<"templates">) {
  const result = await supabase.from("templates").insert(values).select("*").single();
  return unwrap<Tables<"templates">>(result);
}

export async function updateTemplate(supabase: Client, userId: string, id: string, values: TablesUpdate<"templates">) {
  const result = await supabase
    .from("templates")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"templates">>(result);
}

export async function deleteTemplate(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("templates").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}
