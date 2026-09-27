import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { LeadSegmentRule } from "@/lib/validations/lead-segments";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function listLeadSegments(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("lead_segments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getLeadSegment(supabase: Client, userId: string, id: string) {
  const result = await supabase.from("lead_segments").select("*").eq("user_id", userId).eq("id", id).single();
  return unwrap<Tables<"lead_segments">>(result);
}

export async function createLeadSegment(supabase: Client, values: TablesInsert<"lead_segments">) {
  const result = await supabase.from("lead_segments").insert(values).select("*").single();
  return unwrap<Tables<"lead_segments">>(result);
}

export async function updateLeadSegment(
  supabase: Client,
  userId: string,
  id: string,
  values: TablesUpdate<"lead_segments">,
) {
  const result = await supabase
    .from("lead_segments")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"lead_segments">>(result);
}

export async function deleteLeadSegment(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("lead_segments").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

function leadsQuery(supabase: Client) {
  return supabase.from("leads").select("*", { count: "exact" });
}
export type LeadsQuery = ReturnType<typeof leadsQuery>;

// ILIKE treats `%` and `_` as wildcards and `\` as their escape. `*` (which
// PostgREST also treats as a wildcard) is rejected by the rule schema
// instead, since it has no escape.
export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function startOfUtcDay(date: string, addDays = 0) {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + addDays);
  return day.toISOString();
}

// Turns validated segment rules into PostgREST filters, AND-ed. Only the
// query builder's typed filter methods are used — every rule value reaches
// PostgREST as a URL-encoded filter value, never as a hand-assembled filter
// string — so callers must pass rules from parseSegmentRules(), never raw
// input. Text rules are case-insensitive; dates are whole UTC days.
export function applySegmentRules(query: LeadsQuery, rules: readonly LeadSegmentRule[]): LeadsQuery {
  let filtered = query;
  for (const rule of rules) {
    switch (rule.field) {
      case "status":
      case "verification_status": {
        const column = rule.field;
        if (rule.operator === "is") filtered = filtered.eq(column, rule.value);
        else if (rule.operator === "is_not") filtered = filtered.neq(column, rule.value);
        else if (rule.operator === "in") filtered = filtered.in(column, rule.values);
        else for (const value of rule.values) filtered = filtered.neq(column, value);
        break;
      }
      case "list_id":
        filtered = filtered.in("list_id", rule.values);
        break;
      case "company":
      case "title":
      case "city":
      case "country": {
        const escaped = escapeLikePattern(rule.value);
        filtered = filtered.ilike(rule.field, rule.operator === "contains" ? `%${escaped}%` : escaped);
        break;
      }
      case "email_domain":
        filtered = filtered.ilike("email", `%@${escapeLikePattern(rule.value)}`);
        break;
      case "created_at":
        filtered =
          rule.operator === "before"
            ? filtered.lt("created_at", startOfUtcDay(rule.value))
            : filtered.gte("created_at", startOfUtcDay(rule.value, 1));
        break;
    }
  }
  return filtered;
}

export async function countLeadsMatchingRules(supabase: Client, userId: string, rules: readonly LeadSegmentRule[]) {
  const query = supabase.from("leads").select("*", { count: "exact", head: true }).eq("user_id", userId);
  const { count, error } = await applySegmentRules(query, rules);
  if (error) throw error;
  return count ?? 0;
}

// The snapshot a segment enrollment uses: the leads matching right now,
// newest first, capped the same way list enrollment is (listLeads' limit).
export async function listLeadsMatchingRules(
  supabase: Client,
  userId: string,
  rules: readonly LeadSegmentRule[],
  options: { limit: number },
) {
  const query = leadsQuery(supabase).eq("user_id", userId).order("created_at", { ascending: false }).limit(options.limit);
  const { data, error } = await applySegmentRules(query, rules);
  if (error) throw error;
  return data;
}
