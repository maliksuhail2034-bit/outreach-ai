import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Organization-scoped reads/writes — the settings page's CRUD, RLS-enforced.

export async function listIntegrations(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getIntegration(supabase: Client, organizationId: string, id: string) {
  const result = await supabase
    .from("integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .single();
  return unwrap<Tables<"integrations">>(result);
}

export async function getIntegrationByProvider(supabase: Client, organizationId: string, provider: string) {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Upserted on (organization_id, provider) — same reasoning as
// upsertMailboxHealth (lib/db/deliverability.ts): connecting an already-
// connected provider replaces its config/status rather than needing
// separate insert-vs-update branching.
export async function upsertIntegration(supabase: Client, values: TablesInsert<"integrations">) {
  const result = await supabase
    .from("integrations")
    .upsert(values, { onConflict: "organization_id,provider" })
    .select("*")
    .single();
  return unwrap<Tables<"integrations">>(result);
}

export async function updateIntegration(
  supabase: Client,
  organizationId: string,
  id: string,
  values: TablesUpdate<"integrations">,
) {
  const result = await supabase
    .from("integrations")
    .update(values)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("*")
    .single();
  return unwrap<Tables<"integrations">>(result);
}

export async function deleteIntegration(supabase: Client, organizationId: string, id: string) {
  const { error } = await supabase.from("integrations").delete().eq("organization_id", organizationId).eq("id", id);
  if (error) throw error;
}

// --- Admin-context reads/writes — reserved for the digest worker
// (lib/integrations/digest-worker.ts), which has no user/organization
// membership in the loop. Same carve-out as
// listActiveMailboxesForHealthCheck (lib/db/mailboxes.ts).

// Defensive ceiling only (Scalability Track, Item 2) — this is a
// platform-wide, unbounded read across every organization's integrations,
// processed sequentially in one cron invocation. A real batched/claimed
// pattern (mirroring claim_due_sends()) is a later item; this just stops
// unbounded growth from getting worse in the meantime.
const DEFENSIVE_LIST_LIMIT = 1000;

export async function listEnabledIntegrations(supabase: Client): Promise<Tables<"integrations">[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .eq("status", "enabled")
    .limit(DEFENSIVE_LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

// Narrower than updateIntegration — only ever touches the three
// delivery-result columns, never config/status, so the worker can't drift
// a user's own settings.
export async function recordIntegrationDeliveryResult(
  supabase: Client,
  id: string,
  result: { status: "success" | "failed"; error: string | null },
) {
  const { error } = await supabase
    .from("integrations")
    .update({ last_sent_at: new Date().toISOString(), last_status: result.status, last_error: result.error })
    .eq("id", id);
  if (error) throw error;
}
