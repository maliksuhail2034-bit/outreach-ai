import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Warmup profiles -------------------------------------------------------

export async function listWarmupProfiles(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from("warmup_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getWarmupProfileByMailbox(supabase: Client, organizationId: string, mailboxId: string) {
  const { data, error } = await supabase
    .from("warmup_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("mailbox_id", mailboxId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Admin-context equivalent of getWarmupProfileByMailbox — filtered by
// mailbox_id only, no organization_id. Reserved for trusted worker code with
// no user/organization in the loop (lib/deliverability/health-check-worker.ts);
// the service-role client already bypasses RLS, so the extra organization
// scope that protects a user-facing read isn't meaningful here.
export async function getWarmupProfileByMailboxId(supabase: Client, mailboxId: string) {
  const { data, error } = await supabase.from("warmup_profiles").select("*").eq("mailbox_id", mailboxId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createWarmupProfile(supabase: Client, values: TablesInsert<"warmup_profiles">) {
  const result = await supabase.from("warmup_profiles").insert(values).select("*").single();
  return unwrap<Tables<"warmup_profiles">>(result);
}

export async function updateWarmupProfile(
  supabase: Client,
  organizationId: string,
  mailboxId: string,
  values: TablesUpdate<"warmup_profiles">,
) {
  const result = await supabase
    .from("warmup_profiles")
    .update(values)
    .eq("organization_id", organizationId)
    .eq("mailbox_id", mailboxId)
    .select("*")
    .single();
  return unwrap<Tables<"warmup_profiles">>(result);
}

// --- Warmup events (append-only) -------------------------------------------

export async function insertWarmupEvent(supabase: Client, values: TablesInsert<"warmup_events">) {
  const result = await supabase.from("warmup_events").insert(values).select("*").single();
  return unwrap<Tables<"warmup_events">>(result);
}

export async function listWarmupEvents(supabase: Client, organizationId: string, warmupProfileId: string) {
  const { data, error } = await supabase
    .from("warmup_events")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("warmup_profile_id", warmupProfileId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// --- Warmup stats ------------------------------------------------------------
// Architecture only — no pipeline writes these yet (see the migration:
// warmup_stats has no insert/update/delete policy for the RLS-scoped
// client). Provided as the ready-made read/write seam for a future
// stats-aggregation worker, the same way the rest of this file exists
// before anything in the UI actually calls it.

export async function listWarmupStats(supabase: Client, organizationId: string, warmupProfileId: string) {
  const { data, error } = await supabase
    .from("warmup_stats")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("warmup_profile_id", warmupProfileId)
    .order("stat_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Service-role-only write — warmup_stats has no insert policy for the
// RLS-scoped client. Reserved for a future stats-aggregation worker;
// nothing calls this yet.
export async function insertWarmupStat(supabase: Client, values: TablesInsert<"warmup_stats">) {
  const result = await supabase.from("warmup_stats").insert(values).select("*").single();
  return unwrap<Tables<"warmup_stats">>(result);
}
