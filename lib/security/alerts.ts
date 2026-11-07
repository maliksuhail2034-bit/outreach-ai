import type { AuthEventSummary } from "./auth-summary";

// Security alerts derived from data the app already records: sign-in
// outcomes (auth_events, aggregated in SQL by auth_event_summary()), cron
// health (job_runs), the IP blocklist and the staff audit chain. Pure, so
// every rule is unit-tested; the Alerts tab loads the inputs and renders the
// result.

export type AlertSeverity = "critical" | "warning" | "info";

export interface SecurityAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  // Set when the alert is about one source address, so the panel can offer
  // "Block this IP".
  ip?: string;
  alreadyBlocked?: boolean;
}

export interface AlertInputs {
  summary: AuthEventSummary;
  unhealthyJobs: readonly { job: string; error: string | null }[];
  blockedIps: ReadonlySet<string>;
  auditChain: { checked: number; firstBrokenSeq: number | null } | null;
}

export const IP_FAILURE_WARNING = 10;
export const IP_FAILURE_CRITICAL = 50;
export const ACCOUNT_FAILURE_WARNING = 5;

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function buildSecurityAlerts(inputs: AlertInputs): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  const { summary } = inputs;

  if (inputs.auditChain && inputs.auditChain.firstBrokenSeq !== null) {
    alerts.push({
      id: "audit-chain",
      severity: "critical",
      title: "Staff audit log failed verification",
      detail: `Entry #${inputs.auditChain.firstBrokenSeq} doesn't match its hash chain — the log may have been edited outside the app. Investigate with direct database access logs.`,
    });
  }

  for (const row of summary.by_ip) {
    if (row.failures < IP_FAILURE_WARNING) continue;
    const alreadyBlocked = inputs.blockedIps.has(row.ip);
    alerts.push({
      id: `ip-failures:${row.ip}`,
      severity: row.failures >= IP_FAILURE_CRITICAL && !alreadyBlocked ? "critical" : "warning",
      title: `${row.failures} failed sign-ins from ${row.ip}`,
      detail: alreadyBlocked
        ? "This address is already blocked."
        : "Likely password guessing or credential stuffing from one source. Consider blocking it.",
      ip: row.ip,
      alreadyBlocked,
    });
  }

  summary.by_account.forEach((failures, index) => {
    if (failures < ACCOUNT_FAILURE_WARNING) return;
    alerts.push({
      id: `account-failures:${index}`,
      severity: "warning",
      title: `${failures} failed sign-ins against one account`,
      detail: "Someone is repeatedly trying one account's password (the address is stored only as a hash). The per-account rate limit is in force.",
    });
  });

  if (summary.rate_limited > 0) {
    alerts.push({
      id: "rate-limited",
      severity: "info",
      title: `${summary.rate_limited} sign-in attempt${summary.rate_limited === 1 ? "" : "s"} stopped by the rate limit`,
      detail: "Attempts past the per-IP or per-account limit were refused before reaching the password check.",
    });
  }

  for (const row of summary.staff_multi_country) {
    alerts.push({
      id: `staff-countries:${row.user_id}`,
      severity: "warning",
      title: "Staff account signed in from several countries",
      detail: `One staff account signed in from ${[...row.countries].sort().join(", ")} in the last 24 hours. Confirm it was them; if not, lock it and sign it out everywhere.`,
    });
  }

  const jobCounts = new Map<string, number>();
  for (const run of inputs.unhealthyJobs) jobCounts.set(run.job, (jobCounts.get(run.job) ?? 0) + 1);
  for (const [job, count] of jobCounts) {
    alerts.push({
      id: `job:${job}`,
      severity: "warning",
      title: `Background job "${job}" reported ${count} problem${count === 1 ? "" : "s"}`,
      detail: inputs.unhealthyJobs.find((run) => run.job === job && run.error)?.error ?? "See job_runs for details.",
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
