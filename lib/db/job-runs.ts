import type { TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";

// Admin-context write only — reserved for lib/monitoring/run-cron-job.ts,
// which has no user/organization membership in the loop, same carve-out as
// listEnabledIntegrations (lib/db/integrations.ts). job_runs has no RLS
// policies at all, so this only ever works against the service-role client.
export async function recordJobRun(supabase: Client, values: TablesInsert<"job_runs">): Promise<void> {
  const { error } = await supabase.from("job_runs").insert(values);
  if (error) throw error;
}
