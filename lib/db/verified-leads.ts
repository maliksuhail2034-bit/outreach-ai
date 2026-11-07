import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Verified-lead pool data access. Service-role client only (staff console
// and workers); customers never read these tables directly.

export type VerifiedLeadStatus = "active" | "retired" | "suppressed";

export interface VerifiedLeadFilters {
  status?: VerifiedLeadStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listVerifiedLeads(supabase: Client, filters: VerifiedLeadFilters = {}) {
  let query = supabase
    .from("verified_leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.search) {
    // PostgREST "or" filter: escape the characters it treats as syntax.
    const term = filters.search.replace(/[,()*%\\]/g, " ").trim();
    if (term) query = query.or(`email.ilike.*${term}*,company.ilike.*${term}*,last_name.ilike.*${term}*`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function countVerifiedLeadsByStatus(supabase: Client) {
  const statuses: VerifiedLeadStatus[] = ["active", "retired", "suppressed"];
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await supabase.from("verified_leads").select("id", { count: "exact", head: true }).eq("status", status);
      if (error) throw error;
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<VerifiedLeadStatus, number>;
}

// Which of these (lowercased) addresses are already in the pool.
export async function listExistingVerifiedEmails(supabase: Client, emails: string[]) {
  const found = new Set<string>();
  for (let index = 0; index < emails.length; index += 200) {
    const { data, error } = await supabase.from("verified_leads").select("email").in("email", emails.slice(index, index + 200));
    if (error) throw error;
    for (const row of data ?? []) found.add(row.email);
  }
  return found;
}

// Addresses any customer has had unsubscribe or bounce — never added to the
// pool (they objected or don't exist).
export async function listGloballySuppressedEmails(supabase: Client, emails: string[]) {
  const found = new Set<string>();
  for (let index = 0; index < emails.length; index += 200) {
    const { data, error } = await supabase
      .from("suppressions")
      .select("email")
      .in("email", emails.slice(index, index + 200))
      .in("reason", ["unsubscribed", "bounced"]);
    if (error) throw error;
    for (const row of data ?? []) found.add(row.email.toLowerCase());
  }
  return found;
}

export async function insertVerifiedLeadBatch(supabase: Client, values: TablesInsert<"verified_lead_batches">) {
  return unwrap<Tables<"verified_lead_batches">>(await supabase.from("verified_lead_batches").insert(values).select("*").single());
}

export async function updateVerifiedLeadBatch(supabase: Client, id: string, values: TablesUpdate<"verified_lead_batches">) {
  const { error } = await supabase.from("verified_lead_batches").update(values).eq("id", id);
  if (error) throw error;
}

export async function listVerifiedLeadBatches(supabase: Client, limit = 50) {
  const { data, error } = await supabase
    .from("verified_lead_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Bulk insert, in chunks; rows whose email is already present are skipped
// by the unique constraint rather than failing the batch.
export async function insertVerifiedLeads(supabase: Client, rows: TablesInsert<"verified_leads">[]) {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const { data, error } = await supabase
      .from("verified_leads")
      .upsert(rows.slice(index, index + 500), { onConflict: "email", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    inserted += data?.length ?? 0;
  }
  return inserted;
}

export async function updateVerifiedLeadStatus(supabase: Client, ids: string[], status: VerifiedLeadStatus, reason?: string) {
  const values: TablesUpdate<"verified_leads"> =
    status === "suppressed"
      ? { status, suppressed_at: new Date().toISOString(), suppressed_reason: reason ?? "staff" }
      : { status };
  let query = supabase.from("verified_leads").update(values).in("id", ids);
  // A suppressed lead (the person objected or bounced) is never brought back:
  // reactivation only applies to retired leads, retirement only to active ones.
  if (status === "active") query = query.eq("status", "retired");
  if (status === "retired") query = query.eq("status", "active");
  const { data, error } = await query.select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// --- Plan quotas ------------------------------------------------------------

export async function listPlanLeadQuotas(supabase: Client) {
  const { data, error } = await supabase.from("plan_lead_quotas").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function updatePlanLeadQuota(supabase: Client, planId: string, leadsPerMonth: number, updatedBy: string) {
  const { data, error } = await supabase
    .from("plan_lead_quotas")
    .update({ leads_per_month: leadsPerMonth, updated_by: updatedBy })
    .eq("plan_id", planId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// --- Allocation ---------------------------------------------------------------

export async function allocateVerifiedLeads(
  supabase: Client,
  args: { organizationId: string; userId: string; period: string; planId: string; quota: number },
): Promise<number> {
  const { data, error } = await supabase.rpc("allocate_verified_leads", {
    p_organization_id: args.organizationId,
    p_user_id: args.userId,
    p_period: args.period,
    p_plan_id: args.planId,
    p_quota: args.quota,
  });
  if (error) throw error;
  return data ?? 0;
}

export async function listAllocationsForPeriod(supabase: Client, period: string) {
  const { data, error } = await supabase.from("verified_lead_allocations").select("*").eq("period", period);
  if (error) throw error;
  return data ?? [];
}

// The customer's own allocation summary (RLS: member can read their org's
// rows) — used on the customer Leads page with the user-scoped client.
export async function getOrganizationAllocation(supabase: Client, organizationId: string, period: string) {
  const { data, error } = await supabase
    .from("verified_lead_allocations")
    .select("period, quota, delivered_count, lead_list_id")
    .eq("organization_id", organizationId)
    .eq("period", period)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// --- Contact resolution (send pipeline) ---------------------------------------

// The real address behind a delivered verified lead, only if that lead row
// really was delivered to its owner (a matching delivery record exists) —
// defense in depth on top of the database guard that stops customers from
// setting verified_lead_id themselves. Returns null when it doesn't check out.
export async function getDeliveredVerifiedLeadEmail(supabase: Client, lead: Pick<Tables<"leads">, "id" | "user_id" | "verified_lead_id">) {
  if (!lead.verified_lead_id) return null;
  const { data, error } = await supabase
    .from("verified_lead_deliveries")
    .select("verified_lead:verified_leads(email, status)")
    .eq("lead_id", lead.id)
    .eq("user_id", lead.user_id)
    .eq("verified_lead_id", lead.verified_lead_id)
    .maybeSingle();
  if (error) throw error;
  const verified = (data as { verified_lead: { email: string; status: string } | null } | null)?.verified_lead;
  return verified ? { email: verified.email, status: verified.status as VerifiedLeadStatus } : null;
}

// Lead ids of one user whose verified (real) address is `email` — the reply
// worker's sender-address fallback for delivered leads.
export async function listDeliveredLeadIdsByRealEmail(supabase: Client, userId: string, email: string) {
  const { data, error } = await supabase
    .from("verified_lead_deliveries")
    .select("lead_id, verified_lead:verified_leads!inner(email)")
    .eq("user_id", userId)
    .eq("verified_lead.email", email.toLowerCase());
  if (error) throw error;
  return (data ?? []).map((row) => row.lead_id).filter((id): id is string => Boolean(id));
}

// The pool's own verification result for a delivered lead, mapped to the
// customer-facing lead status exactly as allocate_verified_leads() maps it.
export async function getVerifiedLeadVerificationStatus(supabase: Client, verifiedLeadId: string) {
  const { data, error } = await supabase.from("verified_leads").select("verification_result").eq("id", verifiedLeadId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data.verification_result === "valid" || data.verification_result === "catch_all" ? data.verification_result : "unknown";
}
