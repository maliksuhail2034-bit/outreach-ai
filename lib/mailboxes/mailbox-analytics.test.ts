import { describe, expect, it } from "vitest";
import type { Client, MailboxSafe } from "@/lib/db";
import { loadMailboxAnalyticsSnapshot } from "./mailbox-analytics";

// Batch 9C integration coverage: loadMailboxAnalyticsSnapshot had zero test
// coverage before this — the exact place analytics_daily_rollups rows
// (which now include real 'opened'/'clicked' counts, aggregated by
// lib/analytics/rollup-worker.ts from real email_events) get wired into
// summarizeMailboxMetrics. Same fake-Client-keyed-by-table pattern as
// lib/campaigns/campaign-analytics.test.ts.
function createFakeClient(tableRows: Record<string, unknown[]>): Client {
  function createChainable(rows: unknown[]) {
    const chainable = {
      select: () => chainable,
      eq: () => chainable,
      in: () => chainable,
      gte: () => chainable,
      lte: () => chainable,
      order: () => chainable,
      limit: () => chainable,
      maybeSingle: () => Promise.resolve({ data: (rows[0] as unknown) ?? null, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return chainable;
  }
  const from = (table: string) => createChainable(tableRows[table] ?? []);
  return { from } as unknown as Client;
}

const MAILBOX = { id: "mailbox-1", user_id: "user-1", email: "sender@example.com", display_name: null } as unknown as MailboxSafe;

function rollupRow(eventType: string, eventCount: number): unknown {
  return {
    organization_id: "org-1",
    rollup_date: "2026-01-01",
    event_type: eventType,
    subject_type: "mailbox",
    subject_id: "mailbox-1",
    event_count: eventCount,
  };
}

describe("loadMailboxAnalyticsSnapshot", () => {
  it("computes non-null open/click rates from real rolled-up opened/clicked counts when the mailbox has sent mail", async () => {
    const client = createFakeClient({
      analytics_daily_rollups: [rollupRow("sent", 10), rollupRow("opened", 4), rollupRow("clicked", 2)],
      analytics_events: [],
      mailbox_health: [],
    });

    const snapshot = await loadMailboxAnalyticsSnapshot(client, "org-1", MAILBOX);

    expect(snapshot.overview.sentCount).toBe(10);
    expect(snapshot.overview.openedCount).toBe(4);
    expect(snapshot.overview.clickedCount).toBe(2);
    // Batch 9C: denominator is sentCount, not deliveredCount (always 0 —
    // no 'delivered' producer exists) — see lib/analytics/mailbox-metrics.ts.
    expect(snapshot.overview.openRate).toBe(40); // 4 / 10
    expect(snapshot.overview.clickRate).toBe(20); // 2 / 10
  });

  it("returns null open/click rates when the mailbox hasn't sent anything yet", async () => {
    const client = createFakeClient({
      analytics_daily_rollups: [rollupRow("opened", 1)],
      analytics_events: [],
      mailbox_health: [],
    });

    const snapshot = await loadMailboxAnalyticsSnapshot(client, "org-1", MAILBOX);

    expect(snapshot.overview.sentCount).toBe(0);
    expect(snapshot.overview.openRate).toBeNull();
    expect(snapshot.overview.clickRate).toBeNull();
  });

  it("returns zero counts and null rates for a brand-new mailbox with no rollups at all", async () => {
    const client = createFakeClient({});

    const snapshot = await loadMailboxAnalyticsSnapshot(client, "org-1", MAILBOX);

    expect(snapshot.overview.sentCount).toBe(0);
    expect(snapshot.overview.openedCount).toBe(0);
    expect(snapshot.overview.clickedCount).toBe(0);
    expect(snapshot.overview.openRate).toBeNull();
    expect(snapshot.overview.clickRate).toBeNull();
    expect(snapshot.health).toBeNull();
  });
});
