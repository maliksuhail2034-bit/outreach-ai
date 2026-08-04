import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

const DEFAULT_LIST_LIMIT = 100;

export async function listLeads(
  supabase: Client,
  userId: string,
  options?: { listId?: string; limit?: number },
) {
  let query = supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? DEFAULT_LIST_LIMIT);

  if (options?.listId) {
    query = query.eq("list_id", options.listId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function countLeads(supabase: Client, userId: string) {
  const { count, error } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

export async function getLead(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("leads").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"leads">>(result);
}

// Admin-context read used by the sending worker — same carve-out as
// getMailboxCredentials/getCampaignById. Restricted to trusted server-only
// callers.
export async function getLeadById(supabase: Client, id: string) {
  const result = await supabase.from("leads").select("*").eq("id", id).single();
  return unwrap<Tables<"leads">>(result);
}

// Reply-tracking fallback-matching helper (see lib/email/reply-worker.ts) —
// scoped to a specific user (the mailbox owner, passed explicitly since
// this runs under the admin client with no session to derive it from),
// never a cross-user lookup.
export async function listLeadIdsByEmail(supabase: Client, userId: string, email: string) {
  const { data, error } = await supabase.from("leads").select("id").eq("user_id", userId).eq("email", email);
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

export async function createLead(supabase: Client, values: TablesInsert<"leads">) {
  const result = await supabase.from("leads").insert(values).select("*").single();
  return unwrap<Tables<"leads">>(result);
}

export async function updateLead(supabase: Client, userId: string, id: string, values: TablesUpdate<"leads">) {
  const result = await supabase
    .from("leads")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"leads">>(result);
}

export async function deleteLead(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("leads").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

export async function deleteLeads(supabase: Client, userId: string, ids: string[]) {
  const { error } = await supabase.from("leads").delete().eq("user_id", userId).in("id", ids);
  if (error) throw error;
}

// Deletes every lead for the user, not just the ones currently loaded in the
// UI (listLeads caps at DEFAULT_LIST_LIMIT) — scoped by user_id alone rather
// than an id list.
export async function deleteAllLeads(supabase: Client, userId: string) {
  const { error } = await supabase.from("leads").delete().eq("user_id", userId);
  if (error) throw error;
}

// --- Email verification (see lib/verification/) ---

export interface LeadVerificationResult {
  verification_status: string;
  verification_risk_score: number | null;
  verification_detail: TablesUpdate<"leads">["verification_detail"];
  verified_at: string;
}

// User-owned single-lead path (lib/verification/verify.ts, triggered by a
// direct "Verify" click) — ownership-checked like updateLead. Also clears
// any stale claim lock so a lead verified manually while queued doesn't
// stay locked out from the next bulk pass unnecessarily.
export async function updateLeadVerification(
  supabase: Client,
  userId: string,
  id: string,
  values: LeadVerificationResult,
) {
  const result = await supabase
    .from("leads")
    .update({ ...values, verification_locked_until: null })
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"leads">>(result);
}

// Admin-context write used by the bulk verification worker (see
// lib/verification/bulk-worker.ts) — same carve-out as getLeadById /
// getMailboxCredentials: no user in the loop, the row was already scoped by
// claim_due_verifications(). Clears the claim lock so the row isn't left
// permanently locked out.
export async function setLeadVerificationResult(supabase: Client, id: string, values: LeadVerificationResult) {
  const { error } = await supabase
    .from("leads")
    .update({ ...values, verification_locked_until: null })
    .eq("id", id);
  if (error) throw error;
}

// Marks leads as queued for the verify-leads cron worker. Scoped to the
// requesting user's own leads. Re-verifying is allowed from any status, not
// just 'unverified' — a lead's email can change or a provider's earlier
// answer can go stale.
export async function queueLeadsForVerification(supabase: Client, userId: string, ids: string[]) {
  const { error } = await supabase
    .from("leads")
    .update({ verification_status: "pending", verification_locked_until: null })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
}

export async function queueAllLeadsForVerification(supabase: Client, userId: string) {
  const { error } = await supabase
    .from("leads")
    .update({ verification_status: "pending", verification_locked_until: null })
    .eq("user_id", userId);
  if (error) throw error;
}

// Admin-context claim used by the bulk verification worker — calls the
// claim_due_verifications() Postgres function (see the leads_verification
// migration), which mirrors claim_due_sends()'s atomic `for update skip
// locked` row claim so an overlapping worker invocation can't double-claim
// (and double-spend provider credits on) the same lead.
export async function claimDueVerifications(supabase: Client, limit: number) {
  const { data, error } = await supabase.rpc("claim_due_verifications", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as Tables<"leads">[];
}
