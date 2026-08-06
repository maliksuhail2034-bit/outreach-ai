import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Defensive ceiling only (Scalability Track, Item 2) — real pagination for
// this list is a separate, later item. Chosen well above any current real
// per-user campaign count so today's behavior is unchanged; this just stops
// an unbounded fetch from getting worse while the real fix is pending.
const DEFENSIVE_LIST_LIMIT = 1000;

export async function listCampaigns(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(DEFENSIVE_LIST_LIMIT);
  if (error) throw error;
  return data;
}

const DEFAULT_PAGE_SIZE = 100;

export interface PaginatedCampaigns {
  campaigns: Tables<"campaigns">[];
  page: number;
  pageSize: number;
  totalCount: number;
}

// Wired into app/(app)/campaigns/page.tsx (Scalability Track, Phase D). Same
// shape as lib/db/leads.ts's listLeadsPage(): one query with
// `{ count: "exact" }` + `.range()` returns both the page of rows and the
// total count together, and the same PGRST103 ("Requested range not
// satisfiable" — PostgREST rejects an out-of-range offset outright rather
// than returning zero rows, confirmed live in Phase D, Step 3) fallback to
// the last real page instead of throwing.
export async function listCampaignsPage(
  supabase: Client,
  userId: string,
  options?: { page?: number; pageSize?: number },
): Promise<PaginatedCampaigns> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  let page = Math.max(options?.page ?? 1, 1);

  const buildQuery = (from: number, to: number) =>
    supabase
      .from("campaigns")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);

  let from = (page - 1) * pageSize;
  let to = from + pageSize - 1;
  let result = await buildQuery(from, to);

  if (result.error) {
    if ((result.error as { code?: string }).code !== "PGRST103") throw result.error;

    const { count: totalCount, error: countError } = await supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw countError;

    page = Math.max(Math.ceil((totalCount ?? 0) / pageSize), 1);
    from = (page - 1) * pageSize;
    to = from + pageSize - 1;
    result = await buildQuery(from, to);
    if (result.error) throw result.error;
  }

  return { campaigns: result.data ?? [], page, pageSize, totalCount: result.count ?? 0 };
}

export async function countCampaigns(supabase: Client, userId: string) {
  const { count, error } = await supabase
    .from("campaigns")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

export async function getCampaign(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("campaigns").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"campaigns">>(result);
}

// Admin-context read used by the sending worker, which has no user in the
// loop and can't supply the userId getCampaign() requires — same carve-out
// as getMailboxCredentials in lib/db/mailboxes.ts. Restricted to trusted
// server-only callers.
export async function getCampaignById(supabase: Client, id: string) {
  const result = await supabase.from("campaigns").select("*").eq("id", id).single();
  return unwrap<Tables<"campaigns">>(result);
}

export async function createCampaign(supabase: Client, values: TablesInsert<"campaigns">) {
  const result = await supabase.from("campaigns").insert(values).select("*").single();
  return unwrap<Tables<"campaigns">>(result);
}

export async function updateCampaign(supabase: Client, userId: string, id: string, values: TablesUpdate<"campaigns">) {
  const result = await supabase
    .from("campaigns")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"campaigns">>(result);
}

export async function deleteCampaign(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("campaigns").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}
