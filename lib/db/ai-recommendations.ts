import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Organization-scoped reads/writes, RLS-enforced. Append-only (no update
// policy — see the migration) so there's no updateXxx here, matching
// warmup_events' shape.

export async function insertAiRecommendation(supabase: Client, values: TablesInsert<"ai_recommendations">) {
  const result = await supabase.from("ai_recommendations").insert(values).select("*").single();
  return unwrap<Tables<"ai_recommendations">>(result);
}

// Most recent recommendation for one entity — entityId is null only for
// entityType 'organization', matching the migration's check constraint.
export async function getLatestRecommendation(
  supabase: Client,
  organizationId: string,
  entityType: string,
  entityId: string | null,
) {
  let query = supabase
    .from("ai_recommendations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType);
  query = entityId ? query.eq("entity_id", entityId) : query.is("entity_id", null);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}
