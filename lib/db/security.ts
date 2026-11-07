import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Security-panel data access (service-role client only; see lib/db/staff.ts).

// --- Sign-in events ----------------------------------------------------------

export async function insertAuthEvent(supabase: Client, values: TablesInsert<"auth_events">) {
  const { error } = await supabase.from("auth_events").insert(values);
  if (error) throw error;
}

export async function listAuthEvents(supabase: Client, options: { sinceIso: string; limit?: number }) {
  const { data, error } = await supabase
    .from("auth_events")
    .select("*")
    .gte("created_at", options.sinceIso)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 1000);
  if (error) throw error;
  return data ?? [];
}

// --- IP blocklist -------------------------------------------------------------

export async function listIpBlocks(supabase: Client) {
  const { data, error } = await supabase.from("ip_blocklist").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Only entries that are in force right now — what proxy.ts enforces.
export async function listActiveIpBlocks(supabase: Client, nowIso: string) {
  const { data, error } = await supabase
    .from("ip_blocklist")
    .select("cidr, expires_at")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) throw error;
  return (data ?? []).map((row) => ({ cidr: String(row.cidr), expiresAt: row.expires_at }));
}

export async function insertIpBlock(supabase: Client, values: TablesInsert<"ip_blocklist">) {
  return unwrap<Tables<"ip_blocklist">>(await supabase.from("ip_blocklist").insert(values).select("*").single());
}

export async function deleteIpBlock(supabase: Client, id: string) {
  const { data, error } = await supabase.from("ip_blocklist").delete().eq("id", id).select("cidr");
  if (error) throw error;
  return data?.[0] ? String(data[0].cidr) : null;
}

// --- GRC checklist -------------------------------------------------------------

export async function listGrcControls(supabase: Client) {
  const { data, error } = await supabase.from("grc_controls").select("*").order("framework").order("title");
  if (error) throw error;
  return data ?? [];
}

export async function updateGrcControl(supabase: Client, id: string, values: TablesUpdate<"grc_controls">) {
  return unwrap<Tables<"grc_controls">>(await supabase.from("grc_controls").update(values).eq("id", id).select("*").single());
}

// --- Sessions --------------------------------------------------------------------

export async function revokeUserSessions(supabase: Client, userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("staff_revoke_user_sessions", { p_user_id: userId });
  if (error) throw error;
  return data ?? 0;
}

// --- Audit chain / monitoring ---------------------------------------------------

export async function verifyStaffAuditChain(supabase: Client) {
  const { data, error } = await supabase.rpc("staff_verify_audit_chain");
  if (error) throw error;
  const row = data?.[0];
  return { checked: row?.checked ?? 0, firstBrokenSeq: row?.first_broken_seq ?? null };
}

// Cron runs that didn't succeed since `sinceIso` — the security panel's
// "jobs failing" alert.
export async function listUnhealthyJobRuns(supabase: Client, sinceIso: string, limit = 50) {
  const { data, error } = await supabase
    .from("job_runs")
    .select("id, job, status, error, started_at")
    .neq("status", "success")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// One account's sign-in outcomes since a point in time (employee page).
// Successes carry the user id; failures carry only a hash of what was typed
// (the email, or "staff:<username>" at /console/login), so those are matched
// by hash.
export async function listAuthEventsForUser(supabase: Client, userId: string, sinceIso: string, emailHashes: string[] = [], limit = 50) {
  const hashes = emailHashes.filter((hash) => /^[0-9a-f]{64}$/.test(hash));
  const { data, error } = await supabase
    .from("auth_events")
    .select("event_type, ip, country, created_at")
    .or([`user_id.eq.${userId}`, ...(hashes.length ? [`email_hash.in.(${hashes.join(",")})`] : [])].join(","))
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Which of these users have a verified 2-step factor (the Auth admin
// list-users API omits factors). Chunked to keep each call small.
export async function listUsersWithVerifiedMfa(supabase: Client, userIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let index = 0; index < userIds.length; index += 500) {
    const { data, error } = await supabase.rpc("users_with_verified_mfa", { p_user_ids: userIds.slice(index, index + 500) });
    if (error) throw error;
    for (const id of (data ?? []) as string[]) found.add(id);
  }
  return found;
}
