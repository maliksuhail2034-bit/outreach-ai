import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Analytics events (append-only) ----------------------------------------

export async function insertAnalyticsEvent(supabase: Client, values: TablesInsert<"analytics_events">) {
  const result = await supabase.from("analytics_events").insert(values).select("*").single();
  return unwrap<Tables<"analytics_events">>(result);
}

export interface ListAnalyticsEventsOptions {
  eventType?: string;
  subjectType?: string;
  subjectId?: string;
  since?: string; // ISO timestamp, inclusive
  until?: string; // ISO timestamp, inclusive
  limit?: number;
}

const DEFAULT_LIST_LIMIT = 500;

export async function listAnalyticsEvents(
  supabase: Client,
  organizationId: string,
  options?: ListAnalyticsEventsOptions,
) {
  let query = supabase
    .from("analytics_events")
    .select("*")
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(options?.limit ?? DEFAULT_LIST_LIMIT);

  if (options?.eventType) query = query.eq("event_type", options.eventType);
  if (options?.subjectType) query = query.eq("subject_type", options.subjectType);
  if (options?.subjectId) query = query.eq("subject_id", options.subjectId);
  if (options?.since) query = query.gte("occurred_at", options.since);
  if (options?.until) query = query.lte("occurred_at", options.until);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// --- Analytics daily rollups -------------------------------------------------
// Architecture only — no pipeline writes these yet (see the migration:
// analytics_daily_rollups has no insert/update policy for the RLS-scoped
// client). Reserved for a future aggregation worker.

export async function listDailyRollups(
  supabase: Client,
  organizationId: string,
  options?: { since?: string; until?: string; eventType?: string },
) {
  let query = supabase
    .from("analytics_daily_rollups")
    .select("*")
    .eq("organization_id", organizationId)
    .order("rollup_date", { ascending: true });

  if (options?.since) query = query.gte("rollup_date", options.since);
  if (options?.until) query = query.lte("rollup_date", options.until);
  if (options?.eventType) query = query.eq("event_type", options.eventType);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Service-role-only write. Upserted on the table's full unique key so a
// re-run for the same day/subject/event type replaces the prior count
// instead of double-counting.
export async function upsertDailyRollup(supabase: Client, values: TablesInsert<"analytics_daily_rollups">) {
  const result = await supabase
    .from("analytics_daily_rollups")
    .upsert(values, { onConflict: "organization_id,rollup_date,event_type,subject_type,subject_id" })
    .select("*")
    .single();
  return unwrap<Tables<"analytics_daily_rollups">>(result);
}

// --- Analytics snapshots ------------------------------------------------------
// Architecture only — see analytics_daily_rollups above; same carve-out.

export async function listSnapshots(supabase: Client, organizationId: string, options?: { since?: string; until?: string }) {
  let query = supabase
    .from("analytics_snapshots")
    .select("*")
    .eq("organization_id", organizationId)
    .order("snapshot_date", { ascending: true });

  if (options?.since) query = query.gte("snapshot_date", options.since);
  if (options?.until) query = query.lte("snapshot_date", options.until);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// Service-role-only write. Upserted on (organization_id, snapshot_date) so
// re-running a day's snapshot job replaces the prior one.
export async function insertSnapshot(supabase: Client, values: TablesInsert<"analytics_snapshots">) {
  const result = await supabase
    .from("analytics_snapshots")
    .upsert(values, { onConflict: "organization_id,snapshot_date" })
    .select("*")
    .single();
  return unwrap<Tables<"analytics_snapshots">>(result);
}

// --- Analytics jobs -------------------------------------------------------------
// Architecture only — see analytics_daily_rollups above; same carve-out.

export async function listAnalyticsJobs(
  supabase: Client,
  organizationId: string,
  options?: { jobType?: string; status?: string },
) {
  let query = supabase
    .from("analytics_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (options?.jobType) query = query.eq("job_type", options.jobType);
  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createAnalyticsJob(supabase: Client, values: TablesInsert<"analytics_jobs">) {
  const result = await supabase.from("analytics_jobs").insert(values).select("*").single();
  return unwrap<Tables<"analytics_jobs">>(result);
}

export async function updateAnalyticsJob(supabase: Client, id: string, values: TablesUpdate<"analytics_jobs">) {
  const result = await supabase.from("analytics_jobs").update(values).eq("id", id).select("*").single();
  return unwrap<Tables<"analytics_jobs">>(result);
}
