import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function getProfile(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

// One row per user: creates it on first use, otherwise updates it.
export async function upsertProfile(
  supabase: Client,
  userId: string,
  values: Omit<TablesInsert<"profiles">, "user_id">,
) {
  const result = await supabase
    .from("profiles")
    .upsert({ ...values, user_id: userId }, { onConflict: "user_id" })
    .select("*")
    .single();
  return unwrap<Tables<"profiles">>(result);
}
