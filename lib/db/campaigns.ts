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

// Scalability Track, Phase B (item 9, build only — not yet wired into any
// page; app/(app)/campaigns/page.tsx still calls listCampaigns() above
// unchanged). Same shape as lib/db/leads.ts's listLeadsPage(): one query
// with `{ count: "exact" }` + `.range()` returns both the page of rows and
// the total count together.
export async function listCampaignsPage(
  supabase: Client,
  userId: string,
  options?: { page?: number; pageSize?: number },
): Promise<PaginatedCampaigns> {
  const page = Math.max(options?.page ?? 1, 1);
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("campaigns")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;
  return { campaigns: data ?? [], page, pageSize, totalCount: count ?? 0 };
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
