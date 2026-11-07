// Security alerts derived from data the app already records: sign-in
// outcomes (auth_events), cron health (job_runs), the IP blocklist and the
// staff audit chain. Pure, so every rule is unit-tested; the Alerts tab
// loads the inputs and renders the result.

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
  authEvents: readonly {
    event_type: string;
    ip: string | null;
    email_hash: string | null;
    user_id: string | null;
    country: string | null;
  }[];
  unhealthyJobs: readonly { job: string; error: string | null }[];
  blockedIps: ReadonlySet<string>;
  staffUserIds: ReadonlySet<string>;
  auditChain: { checked: number; firstBrokenSeq: number | null } | null;
}

export const IP_FAILURE_WARNING = 10;
export const IP_FAILURE_CRITICAL = 50;
export const ACCOUNT_FAILURE_WARNING = 5;

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function countBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function buildSecurityAlerts(inputs: AlertInputs): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  const failures = inputs.authEvents.filter((event) => event.event_type === "sign_in_failure");

  if (inputs.auditChain && inputs.auditChain.firstBrokenSeq !== null) {
    alerts.push({
      id: "audit-chain",
      severity: "critical",
      title: "Staff audit log failed verification",
      detail: `Entry #${inputs.auditChain.firstBrokenSeq} doesn't match its hash chain — the log may have been edited outside the app. Investigate with direct database access logs.`,
    });
  }

  for (const [ip, count] of countBy(failures, (event) => event.ip)) {
    if (count < IP_FAILURE_WARNING) continue;
    const alreadyBlocked = inputs.blockedIps.has(ip);
    alerts.push({
      id: `ip-failures:${ip}`,
      severity: count >= IP_FAILURE_CRITICAL && !alreadyBlocked ? "critical" : "warning",
      title: `${count} failed sign-ins from ${ip}`,
      detail: alreadyBlocked
        ? "This address is already blocked."
        : "Likely password guessing or credential stuffing from one source. Consider blocking it.",
      ip,
      alreadyBlocked,
    });
  }

  for (const [, count] of countBy(failures, (event) => event.email_hash)) {
    if (count < ACCOUNT_FAILURE_WARNING) continue;
    alerts.push({
      id: `account-failures:${alerts.length}`,
      severity: "warning",
      title: `${count} failed sign-ins against one account`,
      detail: "Someone is repeatedly trying one account's password (the address is stored only as a hash). The per-account rate limit is in force.",
    });
  }

  const rateLimited = inputs.authEvents.filter((event) => event.event_type === "sign_in_rate_limited").length;
  if (rateLimited > 0) {
    alerts.push({
      id: "rate-limited",
      severity: "info",
      title: `${rateLimited} sign-in attempt${rateLimited === 1 ? "" : "s"} stopped by the rate limit`,
      detail: "Attempts past the per-IP or per-account limit were refused before reaching the password check.",
    });
  }

  const staffCountries = new Map<string, Set<string>>();
  for (const event of inputs.authEvents) {
    if (event.event_type !== "sign_in_success" || !event.user_id || !event.country) continue;
    if (!inputs.staffUserIds.has(event.user_id)) continue;
    const countries = staffCountries.get(event.user_id) ?? new Set<string>();
    countries.add(event.country);
    staffCountries.set(event.user_id, countries);
  }
  for (const [userId, countries] of staffCountries) {
    if (countries.size < 2) continue;
    alerts.push({
      id: `staff-countries:${userId}`,
      severity: "warning",
      title: "Staff account signed in from several countries",
      detail: `One staff account signed in from ${[...countries].sort().join(", ")} in the last 24 hours. Confirm it was them; if not, lock it and sign it out everywhere.`,
    });
  }

  for (const [job, count] of countBy(inputs.unhealthyJobs, (run) => run.job)) {
    alerts.push({
      id: `job:${job}`,
      severity: "warning",
      title: `Background job "${job}" reported ${count} problem${count === 1 ? "" : "s"}`,
      detail: inputs.unhealthyJobs.find((run) => run.job === job && run.error)?.error ?? "See job_runs for details.",
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Sign-ins grouped by country for the "Sign-ins & locations" tab.
export function signInsByCountry(events: AlertInputs["authEvents"]) {
  const rows = new Map<string, { country: string; successes: number; failures: number }>();
  for (const event of events) {
    const country = event.country ?? "Unknown";
    const row = rows.get(country) ?? { country, successes: 0, failures: 0 };
    if (event.event_type === "sign_in_success") row.successes += 1;
    else row.failures += 1;
    rows.set(country, row);
  }
  return [...rows.values()].sort((a, b) => b.successes + b.failures - (a.successes + a.failures));
}
