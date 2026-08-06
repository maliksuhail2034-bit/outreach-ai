import type { Client } from "@/lib/db/shared";

export interface RetentionDeletionSummary {
  table: "rate_limit_events" | "job_runs";
  cutoff: string;
  deletedCount: number;
}

export interface RetentionWorkerSummary {
  dryRun: false;
  results: RetentionDeletionSummary[];
}

// Scoped to the two operational-log tables the Scalability Track audit
// identified as safe to prune (Item 11) — rate_limit_events' data has no
// value beyond its own rate-limit window (minutes), and job_runs is a
// monitoring log, not business data. email_events/send_attempts/
// analytics_events are deliberately excluded: they are the historical
// business/reporting data this track's own rollup infrastructure (item 4)
// depends on, so pruning those would mean archiving into aggregated form,
// not deletion, and is out of scope here. audit_logs is also excluded —
// its retention window is a compliance/product decision, not an
// engineering one, and isn't assumed here.
const RATE_LIMIT_EVENTS_RETENTION_DAYS = 7;
const JOB_RUNS_RETENTION_DAYS = 90;

function cutoffIso(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString();
}

// Scalability Track, Phase D (item 11): deletes for real. Phase B/C
// (dry-run counting, then live-verified against real data with the
// Postgres-confirmed shadow validation in ROADMAP.md — both tables reported
// 0 candidates, nothing on the project was old enough yet) are done; this is
// the approved cutover. Uses the plain created_at indexes added in Phase A
// specifically for this query shape (`where created_at < X` with no other
// filter, which neither table's pre-existing composite index could serve).
// Same two tables, same two retention windows as the dry-run had — only the
// query itself changed, from a count-only `select(..., { count: "exact",
// head: true })` to a `delete({ count: "exact" })`, which reports how many
// rows Postgres actually removed via the same Content-Range/count mechanism.
export async function runRetentionWorker(supabase: Client): Promise<RetentionWorkerSummary> {
  const results: RetentionDeletionSummary[] = [];

  const targets: { table: "rate_limit_events" | "job_runs"; days: number }[] = [
    { table: "rate_limit_events", days: RATE_LIMIT_EVENTS_RETENTION_DAYS },
    { table: "job_runs", days: JOB_RUNS_RETENTION_DAYS },
  ];

  for (const { table, days } of targets) {
    const cutoff = cutoffIso(days);
    const { count, error } = await supabase.from(table).delete({ count: "exact" }).lt("created_at", cutoff);
    if (error) throw error;

    const deletedCount = count ?? 0;
    console.log("[retention-worker] deleted", { table, cutoff, deletedCount });
    results.push({ table, cutoff, deletedCount });
  }

  return { dryRun: false, results };
}
