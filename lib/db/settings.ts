import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function getSettings(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

// One row per user: creates it on first use, otherwise updates it.
export async function upsertSettings(
  supabase: Client,
  userId: string,
  values: Omit<TablesInsert<"settings">, "user_id">,
) {
  const result = await supabase
    .from("settings")
    .upsert({ ...values, user_id: userId }, { onConflict: "user_id" })
    .select("*")
    .single();
  return unwrap<Tables<"settings">>(result);
}
