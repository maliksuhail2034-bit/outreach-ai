import type { Client } from "@/lib/db/shared";
import { listMailboxDomainsByIds, upsertDailyRollup } from "@/lib/db";
import { captureError } from "@/lib/monitoring/error-tracking";

export interface AnalyticsRollupSummary {
  since: string;
  until: string;
  rowsComputed: number;
  rowsUpserted: number;
  failed: number;
}

// Defaults to "yesterday" (one full UTC day) — a daily cron tick rolling up
// the day that just completed. A wider {since, until} range (Scalability
// Track item 5's backfill capability) is how the same worker computes
// historical rollups; nothing in Phase B actually invokes it with one yet —
// that is a later, separate step.
function defaultDateRange(): { since: string; until: string } {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const iso = yesterday.toISOString().slice(0, 10);
  return { since: iso, until: iso };
}

// Orchestration only, mirrors every other worker in this codebase
// (send-worker.ts, reply-worker.ts, etc.): the actual aggregation is a
// single SQL statement (compute_email_event_rollups(), see the Scalability
// Track Phase B migration) so this file never fetches raw email_events
// rows into Node — only the already-grouped counts it upserts.
//
// Writes to analytics_daily_rollups only. Nothing in this codebase reads
// from that table yet (Scalability Track Phase D is the cutover) — running
// this worker has zero effect on any current analytics page.
export async function runAnalyticsRollupWorker(
  supabase: Client,
  options?: { since?: string; until?: string },
): Promise<AnalyticsRollupSummary> {
  const { since, until } =
    options?.since && options?.until ? { since: options.since, until: options.until } : defaultDateRange();

  const { data: rows, error } = await supabase.rpc("compute_email_event_rollups", {
    p_since: since,
    p_until: until,
  });
  if (error) throw error;

  const summary: AnalyticsRollupSummary = {
    since,
    until,
    rowsComputed: rows?.length ?? 0,
    rowsUpserted: 0,
    failed: 0,
  };

  for (const row of rows ?? []) {
    try {
      await upsertDailyRollup(supabase, {
        organization_id: row.organization_id,
        rollup_date: row.rollup_date,
        event_type: row.event_type,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        event_count: row.event_count,
      });
      summary.rowsUpserted += 1;
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : "Unknown error.";
      console.error("[analytics-rollup-worker] failed to upsert rollup row", { row, error: message });
      await captureError({
        job: "analytics-rollup",
        message,
        context: {
          organizationId: row.organization_id,
          rollupDate: row.rollup_date,
          eventType: row.event_type,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
        },
      });
    }
  }

  await upsertDomainRollups(supabase, rows ?? [], summary);

  return summary;
}

// Domain-level rollups: email_events has no direct domain link (only
// mailboxes.domain_id does), so rather than a fourth branch in
// compute_email_event_rollups(), this sums the mailbox-level rows the same
// call already produced, grouped by each mailbox's domain — the same
// "resolve mailboxes for a domain, then aggregate their events" pattern
// lib/deliverability/domain-analytics.ts already uses for the live Domain
// Analytics page, applied here to already-aggregated counts instead of raw
// events.
async function upsertDomainRollups(
  supabase: Client,
  rows: {
    organization_id: string;
    rollup_date: string;
    event_type: string;
    subject_type: string;
    subject_id: string;
    event_count: number;
  }[],
  summary: AnalyticsRollupSummary,
): Promise<void> {
  const mailboxRows = rows.filter((row) => row.subject_type === "mailbox");
  if (mailboxRows.length === 0) return;

  const mailboxIds = [...new Set(mailboxRows.map((row) => row.subject_id))];
  const mailboxDomains = await listMailboxDomainsByIds(supabase, mailboxIds);
  const domainIdByMailboxId = new Map(mailboxDomains.map((mailbox) => [mailbox.id, mailbox.domain_id]));

  interface DomainTotal {
    organizationId: string;
    rollupDate: string;
    eventType: string;
    domainId: string;
    eventCount: number;
  }
  const domainTotals = new Map<string, DomainTotal>();

  for (const row of mailboxRows) {
    const domainId = domainIdByMailboxId.get(row.subject_id);
    if (!domainId) continue; // mailbox not linked to a domain — nothing to roll up

    const key = `${row.organization_id}|${row.rollup_date}|${row.event_type}|${domainId}`;
    const existing = domainTotals.get(key);
    if (existing) {
      existing.eventCount += row.event_count;
    } else {
      domainTotals.set(key, {
        organizationId: row.organization_id,
        rollupDate: row.rollup_date,
        eventType: row.event_type,
        domainId,
        eventCount: row.event_count,
      });
    }
  }

  for (const total of domainTotals.values()) {
    try {
      await upsertDailyRollup(supabase, {
        organization_id: total.organizationId,
        rollup_date: total.rollupDate,
        event_type: total.eventType,
        subject_type: "domain",
        subject_id: total.domainId,
        event_count: total.eventCount,
      });
      summary.rowsUpserted += 1;
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : "Unknown error.";
      console.error("[analytics-rollup-worker] failed to upsert domain rollup row", { total, error: message });
      await captureError({
        job: "analytics-rollup",
        message,
        context: {
          organizationId: total.organizationId,
          rollupDate: total.rollupDate,
          eventType: total.eventType,
          subjectType: "domain",
          subjectId: total.domainId,
        },
      });
    }
  }
}
