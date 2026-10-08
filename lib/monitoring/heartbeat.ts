export type CronJobName =
  | "send-emails"
  | "sync-replies"
  | "verify-leads"
  | "deliverability-health-check"
  | "integrations-digest"
  | "analytics-rollup"
  | "retention-cleanup"
  | "warmup-cycle";

const HEARTBEAT_ENV_VAR: Record<CronJobName, string> = {
  "send-emails": "CRON_HEARTBEAT_URL_SEND_EMAILS",
  "sync-replies": "CRON_HEARTBEAT_URL_SYNC_REPLIES",
  "verify-leads": "CRON_HEARTBEAT_URL_VERIFY_LEADS",
  "deliverability-health-check": "CRON_HEARTBEAT_URL_DELIVERABILITY_HEALTH_CHECK",
  "integrations-digest": "CRON_HEARTBEAT_URL_INTEGRATIONS_DIGEST",
  "analytics-rollup": "CRON_HEARTBEAT_URL_ANALYTICS_ROLLUP",
  "retention-cleanup": "CRON_HEARTBEAT_URL_RETENTION_CLEANUP",
  "warmup-cycle": "CRON_HEARTBEAT_URL_WARMUP_CYCLE",
};

// Bounds how long a ping can hang — a slow/unreachable monitoring provider
// must never delay the cron response it's reporting on.
const REQUEST_TIMEOUT_MS = 5_000;

// Dead-man's-switch ping. Compatible with Healthchecks.io's convention (the
// most common free-tier option, and what Cronitor/Better Stack's simple
// ping endpoints also follow): a GET to the configured URL signals success,
// a GET to "<url>/fail" signals failure. No-op until the matching env var is
// set for a given job — same opt-in shape as every other external
// integration in this codebase (see lib/integrations/providers/webhook.ts).
//
// This is what actually detects "the scheduler stopped calling this route
// at all" — job_runs (lib/db/job-runs.ts) can't, since a job that never
// runs never gets a row there either.
//
// A ping that throws or gets a non-2xx response (an unreachable provider, or
// a mistyped URL that 404s) is logged so a misconfiguration shows up in the
// platform logs, but never fails the job, never changes its job_runs row and
// is never forwarded to error tracking: a monitoring outage isn't a job
// failure, and this runs every minute for send-emails. The log names the env
// var, never the URL, which carries the check's secret ping key.
export async function pingHeartbeat(job: CronJobName, outcome: "success" | "fail"): Promise<void> {
  const envVar = HEARTBEAT_ENV_VAR[job];
  const baseUrl = process.env[envVar];
  if (!baseUrl) return;

  const url = outcome === "fail" ? `${baseUrl.replace(/\/$/, "")}/fail` : baseUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) {
      console.error("[heartbeat]", "ping was rejected", { job, outcome, envVar, status: response.status });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error("[heartbeat]", "ping failed", { job, outcome, envVar, error: message });
  } finally {
    clearTimeout(timeout);
  }
}
