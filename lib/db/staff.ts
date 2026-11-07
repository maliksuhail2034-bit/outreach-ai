import type { Json, Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Staff-console data access. Every function here is called with the
// service-role client (lib/supabase/admin.ts) from staff Server Functions or
// pages, after lib/staff/auth.ts's requireStaff() has authorized the caller —
// none of these tables has an RLS policy a customer could use.

export type StaffRole = "owner" | "security" | "sales";
export type StaffStatus = "invited" | "active" | "disabled";

export async function getStaffMemberByUserId(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("staff_members").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getStaffMember(supabase: Client, id: string) {
  const { data, error } = await supabase.from("staff_members").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listStaffMembers(supabase: Client) {
  const { data, error } = await supabase.from("staff_members").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertStaffMember(supabase: Client, values: TablesInsert<"staff_members">) {
  return unwrap<Tables<"staff_members">>(await supabase.from("staff_members").insert(values).select("*").single());
}

export async function updateStaffMember(supabase: Client, id: string, values: TablesUpdate<"staff_members">) {
  return unwrap<Tables<"staff_members">>(await supabase.from("staff_members").update(values).eq("id", id).select("*").single());
}

export async function countActiveOwners(supabase: Client) {
  const { count, error } = await supabase
    .from("staff_members")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

export async function touchStaffLastSeen(supabase: Client, id: string) {
  const { error } = await supabase.from("staff_members").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// --- Audit log -------------------------------------------------------------

export interface StaffAuditEntry {
  actorUserId: string | null;
  actorRole: StaffRole | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  metadata?: Record<string, Json>;
}

export async function insertStaffAuditEntry(supabase: Client, entry: StaffAuditEntry) {
  const { error } = await supabase.from("staff_audit_log").insert({
    actor_user_id: entry.actorUserId,
    actor_role: entry.actorRole,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    ip: entry.ip ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) throw error;
}

export async function listStaffAuditLog(supabase: Client, options: { limit?: number; actorUserId?: string } = {}) {
  let query = supabase
    .from("staff_audit_log")
    .select("*")
    .order("seq", { ascending: false })
    .limit(options.limit ?? 200);
  if (options.actorUserId) query = query.eq("actor_user_id", options.actorUserId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// --- Usernames ---------------------------------------------------------------

// Case-insensitive (usernames are stored lowercase; the unique index is on
// lower(username)).
export async function getStaffMemberByUsername(supabase: Client, username: string) {
  const { data, error } = await supabase.from("staff_members").select("*").eq("username", username.trim().toLowerCase()).maybeSingle();
  if (error) throw error;
  return data;
}

// --- Work sessions -----------------------------------------------------------

export async function touchStaffWorkSession(supabase: Client, staffId: string, country: string | null) {
  const { error } = await supabase.rpc("staff_touch_work_session", { p_staff_id: staffId, p_country: country ?? undefined });
  if (error) throw error;
}

export async function endStaffWorkSession(supabase: Client, staffId: string, reason: "signed_out" | "access_changed" = "signed_out") {
  const { error } = await supabase.rpc("staff_end_work_session", { p_staff_id: staffId, p_reason: reason });
  if (error) throw error;
}

export async function listStaffWorkSessions(supabase: Client, staffId: string, sinceIso: string, limit = 500) {
  const { data, error } = await supabase
    .from("staff_work_sessions")
    .select("id, started_at, last_activity_at, ended_at, end_reason, country")
    .eq("staff_id", staffId)
    .gte("last_activity_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getStaffWorkSeconds(supabase: Client, sinceIso: string) {
  const { data, error } = await supabase.rpc("staff_work_seconds", { p_since: sinceIso });
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.staff_id, { seconds: Number(row.seconds), sessions: Number(row.sessions) }]));
}

// Audit entries one staff member made since a point in time (for "work done").
export async function listStaffActionsSince(supabase: Client, actorUserId: string, sinceIso: string, limit = 1000) {
  const { data, error } = await supabase
    .from("staff_audit_log")
    .select("seq, action, target_type, target_id, metadata, created_at")
    .eq("actor_user_id", actorUserId)
    .gte("created_at", sinceIso)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
