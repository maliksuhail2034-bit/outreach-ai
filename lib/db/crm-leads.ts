import type { Tables } from "@/types/database.types";
import type { LeadSegmentRule, LeadVerificationStatus } from "@/lib/validations/lead-segments";
import type { CrmEngagementFilter, CrmSort } from "@/lib/validations/crm-leads";
import { applySegmentRules, escapeLikePattern } from "./lead-segments";
import { selectAllPages, type Client } from "./shared";

// The Leads page (CRM view): the caller's leads with per-lead engagement,
// read from crm_leads() (supabase/migrations/20261113100000_crm_sequences.sql),
// which applies only the engagement filter. Everything else (search,
// status, list, verification, a segment's rules, sorting, pagination and
// the exact count) is applied here by PostgREST, as on the leads table.

export type CrmLead = Tables<"leads"> & {
  crm_sent: number;
  crm_opens: number;
  crm_clicks: number;
  crm_replies: number;
  crm_last_activity_at: string | null;
};

export interface CrmLeadFilters {
  search?: string;
  status?: string;
  // A list's id, or "none" for leads in no list.
  listId?: string;
  verificationStatus?: LeadVerificationStatus;
  rules?: readonly LeadSegmentRule[];
  engagement?: CrmEngagementFilter;
  campaignId?: string;
  stepId?: string;
  sort?: CrmSort;
}

export interface CrmLeadsPage {
  leads: CrmLead[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export const CRM_PAGE_SIZE = 50;

// Computed fields on leads (crm_*). PostgREST can sort an RPC's result only
// by columns it also selects, hence `*` and every field the sorts use.
const CRM_SELECT = "*, crm_sent, crm_opens, crm_clicks, crm_replies, crm_last_activity_at";

// Characters that would break out of a PostgREST or=(...) filter value.
const OR_FILTER_SPECIALS = /[,()"\\*:]/g;

// Each word must match a name, address or company: "jane acme" finds Jane at Acme.
function searchFilters(search: string): string[] {
  return search
    .replace(OR_FILTER_SPECIALS, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => {
      const pattern = `%${escapeLikePattern(word)}%`;
      return ["email", "display_email", "first_name", "last_name", "company"].map((column) => `${column}.ilike.${pattern}`).join(",");
    });
}

const SORT_ORDERS: Record<CrmSort, { column: string; ascending: boolean; nullsFirst?: boolean }[]> = {
  recent: [{ column: "created_at", ascending: false }],
  activity: [{ column: "crm_last_activity_at", ascending: false, nullsFirst: false }],
  opens: [
    { column: "crm_opens", ascending: false },
    { column: "created_at", ascending: false },
  ],
  clicks: [
    { column: "crm_clicks", ascending: false },
    { column: "created_at", ascending: false },
  ],
  name: [
    { column: "first_name", ascending: true, nullsFirst: false },
    { column: "last_name", ascending: true, nullsFirst: false },
    { column: "email", ascending: true },
  ],
  company: [
    { column: "company", ascending: true, nullsFirst: false },
    { column: "created_at", ascending: false },
  ],
};

// The caller's leads matching `filters`, in the filters' sort order with a
// unique tiebreaker (imported leads share created_at), so pages never overlap.
function crmLeadsQuery(supabase: Client, userId: string, filters: CrmLeadFilters, options: { head?: boolean } = {}) {
  let query = supabase
    .rpc(
      "crm_leads",
      {
        p_engagement: filters.engagement ?? "any",
        ...(filters.campaignId ? { p_campaign_id: filters.campaignId } : {}),
        ...(filters.stepId ? { p_step_id: filters.stepId } : {}),
      },
      { count: "exact", head: options.head ?? false, get: true },
    )
    .select(CRM_SELECT)
    .eq("user_id", userId);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.listId === "none") query = query.is("list_id", null);
  else if (filters.listId) query = query.eq("list_id", filters.listId);
  if (filters.verificationStatus) query = query.eq("verification_status", filters.verificationStatus);
  if (filters.rules) query = applySegmentRules(query, filters.rules);
  for (const filter of searchFilters(filters.search ?? "")) query = query.or(filter);

  for (const order of SORT_ORDERS[filters.sort ?? "recent"]) {
    query = query.order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst });
  }
  return query.order("id", { ascending: true });
}

// Every lead matching `filters`, up to `limit` — the target of a bulk action
// on "all leads matching these filters" (e.g. enrolling everyone who opened
// step 2 into a follow-up campaign).
export async function listAllCrmLeads(supabase: Client, userId: string, filters: CrmLeadFilters, limit: number) {
  return selectAllPages(
    (from, to) => crmLeadsQuery(supabase, userId, filters).range(from, to).overrideTypes<CrmLead[], { merge: false }>(),
    limit,
  );
}

export async function listCrmLeadsPage(
  supabase: Client,
  userId: string,
  filters: CrmLeadFilters,
  requestedPage: number,
  pageSize: number = CRM_PAGE_SIZE,
): Promise<CrmLeadsPage> {
  const buildQuery = (from: number, to: number, head = false) =>
    crmLeadsQuery(supabase, userId, filters, { head }).range(from, to).overrideTypes<CrmLead[], { merge: false }>();

  let page = Math.max(requestedPage, 1);
  let result = await buildQuery((page - 1) * pageSize, page * pageSize - 1);

  // PostgREST answers a page past the end with PGRST103 rather than an empty
  // result (see listLeadsPage); a stale page number falls back to the last page.
  if (result.error && result.error.code === "PGRST103") {
    const { count, error } = await buildQuery(0, 0, true);
    if (error) throw error;
    page = Math.max(Math.ceil((count ?? 0) / pageSize), 1);
    result = await buildQuery((page - 1) * pageSize, page * pageSize - 1);
  }
  if (result.error) throw result.error;

  return {
    leads: result.data ?? [],
    page,
    pageSize,
    totalCount: result.count ?? 0,
  };
}
