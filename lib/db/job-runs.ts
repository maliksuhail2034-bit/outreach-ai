import type { Json, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";

// Admin-context write only — reserved for lib/monitoring/run-cron-job.ts,
// which has no user/organization membership in the loop, same carve-out as
// listEnabledIntegrations (lib/db/integrations.ts). job_runs has no RLS
// policies at all, so this only ever works against the service-role client.
export async function recordJobRun(supabase: Client, values: TablesInsert<"job_runs">): Promise<void> {
  const { error } = await supabase.from("job_runs").insert(values);
  if (error) throw error;
}

// Admin-context read, same carve-out as recordJobRun above — lets
// lib/email/reply-worker.ts compare this run's mailbox failures with the
// previous run's, so a persistent failure alerts once instead of every run.
// Ordered by created_at to use job_runs_job_created_at_idx.
export async function getLatestJobRunSummary(supabase: Client, job: string): Promise<Json | null> {
  const { data, error } = await supabase
    .from("job_runs")
    .select("summary")
    .eq("job", job)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.summary ?? null;
}
