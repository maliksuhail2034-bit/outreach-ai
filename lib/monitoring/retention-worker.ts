import type { Client } from "@/lib/db/shared";

export interface RetentionCandidateSummary {
  table: "rate_limit_events" | "job_runs";
  cutoff: string;
  candidateCount: number;
}

export interface RetentionWorkerSummary {
  dryRun: true;
  results: RetentionCandidateSummary[];
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

// Scalability Track, Phase B (item 11): dry-run only — counts what WOULD be
// deleted, deletes nothing. Uses the plain created_at indexes added in
// Phase A specifically for this query shape (`where created_at < X` with no
// other filter, which neither table's pre-existing composite index could
// serve). Flipping this from counting to actually deleting is a separate,
// later step (Phase D) — this file's shape is deliberately unchanged by
// that flip, only its body's `select(..., { count: "exact", head: true })`
// becomes a `delete()`.
export async function runRetentionWorker(supabase: Client): Promise<RetentionWorkerSummary> {
  const results: RetentionCandidateSummary[] = [];

  const targets: { table: "rate_limit_events" | "job_runs"; days: number }[] = [
    { table: "rate_limit_events", days: RATE_LIMIT_EVENTS_RETENTION_DAYS },
    { table: "job_runs", days: JOB_RUNS_RETENTION_DAYS },
  ];

  for (const { table, days } of targets) {
    const cutoff = cutoffIso(days);
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).lt("created_at", cutoff);
    if (error) throw error;

    const candidateCount = count ?? 0;
    console.log("[retention-worker] dry run", { table, cutoff, candidateCount });
    results.push({ table, cutoff, candidateCount });
  }

  return { dryRun: true, results };
}
