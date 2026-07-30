import type { Client } from "./shared";

// suppressions is owned directly by user_id (no derived-ownership chain —
// see supabase/migrations/20260730100010_suppressions.sql). Bounce/
// unsubscribe rows are written exclusively by record_send_failure (the
// send_attempts migration's RPC), never through this module — there is
// deliberately no insert/create function here; nothing in the app creates
// a suppression directly today.

export async function listSuppressions(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("suppressions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function deleteSuppression(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("suppressions").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}
