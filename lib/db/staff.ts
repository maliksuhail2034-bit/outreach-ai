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
