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

const DEFAULT_PAGE_SIZE = 100;

export interface PaginatedLeads {
  leads: Tables<"leads">[];
  page: number;
  pageSize: number;
  totalCount: number;
}

// Wired into app/(app)/leads/page.tsx (Scalability Track, Phase D). listLeads()
// above is deliberately left as-is rather than extended with a page param —
// it has other callers (e.g. the campaign detail page's `{ limit: 10000 }`
// call) whose exact current behavior this must not change. A single query
// with `{ count: "exact" }` + `.range()` returns both the page of rows and
// the total count together, the same shape countLeads() + listLeads()
// currently require two separate calls for.
//
// PostgREST rejects an out-of-range `.range()` offset outright — HTTP 416
// / error code PGRST103 ("Requested range not satisfiable"), not an empty
// result — confirmed live against the real linked project (Scalability
// Track, Phase D, Step 3) after wiring this into app/(app)/leads/page.tsx
// and hitting a stale/bookmarked page number for real. Falls back to the
// last real page instead of throwing, so a page number that's gone stale
// (e.g. leads were deleted since the URL was bookmarked) self-corrects
// instead of crashing.
export async function listLeadsPage(
  supabase: Client,
  userId: string,
  options?: { page?: number; pageSize?: number; listId?: string },
): Promise<PaginatedLeads> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  let page = Math.max(options?.page ?? 1, 1);

  const buildQuery = (from: number, to: number) => {
    let query = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (options?.listId) query = query.eq("list_id", options.listId);
    return query;
  };

  let from = (page - 1) * pageSize;
  let to = from + pageSize - 1;
  let result = await buildQuery(from, to);

  if (result.error) {
    if ((result.error as { code?: string }).code !== "PGRST103") throw result.error;

    let countQuery = supabase.from("leads").select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (options?.listId) countQuery = countQuery.eq("list_id", options.listId);
    const { count: totalCount, error: countError } = await countQuery;
    if (countError) throw countError;

    page = Math.max(Math.ceil((totalCount ?? 0) / pageSize), 1);
    from = (page - 1) * pageSize;
    to = from + pageSize - 1;
    result = await buildQuery(from, to);
    if (result.error) throw result.error;
  }

  return { leads: result.data ?? [], page, pageSize, totalCount: result.count ?? 0 };
}

// Scalability Track, Phase B (item 7, build only — not yet wired into any
// page). Replaces the campaign detail page's current approach (fetch up to
// 10,000 of the account's leads, fetch every campaign_leads row for the
// campaign, diff the two in JS) with the "not yet enrolled" filter pushed
// into SQL: enrolled lead ids for this one campaign are a small, targeted,
// already-indexed (campaign_leads.campaign_id) read, not an account-wide
// fetch — only that bounded set is pulled into JS, used to build a
// `.not("id", "in", ...)` filter for the leads query itself.
export async function listLeadsAvailableForCampaign(
  supabase: Client,
  userId: string,
  campaignId: string,
  options?: { limit?: number },
) {
  const { data: enrolled, error: enrolledError } = await supabase
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", campaignId);
  if (enrolledError) throw enrolledError;

  const enrolledIds = (enrolled ?? []).map((row) => row.lead_id);

  let query = supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? DEFAULT_LIST_LIMIT);

  // PostgREST's not(...) expects the raw filter-value syntax for the
  // operator it wraps — for "in" that's a parenthesized, comma-separated
  // list (see postgrest-js's own not() doc comment: `.not('id', 'in',
  // '(5,6,7)')`), not a JS array. Safe to interpolate directly: every id
  // here came from campaign_leads.lead_id, a DB-generated uuid column, never
  // raw user input.
  if (enrolledIds.length > 0) {
    query = query.not("id", "in", `(${enrolledIds.join(",")})`);
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

const BATCH_CHUNK_SIZE = 500;

export interface CreateLeadsBatchResult {
  created: Tables<"leads">[];
  // Indexes into the input `values` array that failed to insert, so a
  // caller can attribute a failure back to the original row it came from
  // (e.g. a CSV row number) the same way createLead()'s per-row callers do.
  failedIndexes: number[];
}

// Scalability Track, Phase B (item 10, build only — app/(app)/leads/
// import-actions.ts still calls createLead() per row, unchanged). Inserts
// in chunks via a single array insert per chunk instead of one round trip
// per row. If a chunk's bulk insert fails as a whole (e.g. one malformed
// row), it falls back to inserting that chunk's rows one at a time so a
// single bad row doesn't sacrifice every other row's error attribution —
// preserving the same per-row failure granularity the sequential import
// path already gives callers.
export async function createLeadsBatch(
  supabase: Client,
  values: TablesInsert<"leads">[],
): Promise<CreateLeadsBatchResult> {
  const created: Tables<"leads">[] = [];
  const failedIndexes: number[] = [];

  for (let start = 0; start < values.length; start += BATCH_CHUNK_SIZE) {
    const chunk = values.slice(start, start + BATCH_CHUNK_SIZE);
    const { data, error } = await supabase.from("leads").insert(chunk).select("*");

    if (!error && data) {
      created.push(...data);
      continue;
    }

    for (let i = 0; i < chunk.length; i++) {
      const result = await supabase.from("leads").insert(chunk[i]).select("*").single();
      if (result.error) {
        failedIndexes.push(start + i);
      } else {
        created.push(result.data);
      }
    }
  }

  return { created, failedIndexes };
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
