import type { TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";

// suppressions is owned directly by user_id (no derived-ownership chain —
// see supabase/migrations/20260730100010_suppressions.sql). Bounce rows are
// written exclusively by record_send_failure (the send_attempts migration's
// RPC) — createSuppression below is the second and only other writer,
// used by the unsubscribe flow (lib/email/unsubscribe.ts).

export async function listSuppressions(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("suppressions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getSuppression(supabase: Client, userId: string, email: string) {
  const { data, error } = await supabase
    .from("suppressions")
    .select("*")
    .eq("user_id", userId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Batched form of getSuppression for gating re-enrollment of a lead or an
// entire lead list (see enrollLeadAction/enrollLeadListAction) — one query
// instead of one getSuppression call per lead.
export async function getSuppressedEmails(
  supabase: Client,
  userId: string,
  emails: string[],
): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();

  const { data, error } = await supabase
    .from("suppressions")
    .select("email, reason")
    .eq("user_id", userId)
    .in("email", emails);
  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.email, row.reason]));
}

// Suppressing the same address twice (e.g. a duplicate unsubscribe click)
// hits the unique(user_id, email) constraint — that's the concurrency
// backstop doing its job, not an error, so it's swallowed here rather than
// thrown. Same reasoning as record_send_failure's own
// `on conflict (user_id, email) do nothing`.
export async function createSuppression(supabase: Client, values: TablesInsert<"suppressions">) {
  const { error } = await supabase.from("suppressions").insert(values);
  if (error && !isUniqueViolation(error)) throw error;
}

export async function deleteSuppression(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("suppressions").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
