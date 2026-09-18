import { describe, expect, it } from "vitest";
import type { Client } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { loadCampaignAnalyticsSnapshot } from "./campaign-analytics";

// Batch 9C integration coverage: loadCampaignAnalyticsSnapshot had zero test
// coverage before this — the exact place real email_events rows (including
// 'opened'/'clicked', now that both have real producers) get wired into
// summarizeCampaignMetrics. Mirrors the fake-Client-keyed-by-table pattern
// already used elsewhere (e.g. lib/email/unsubscribe.test.ts) — every
// query-builder method returns the same chainable object per table, which
// resolves via `.then` regardless of how many .eq()/.order()/.limit() calls
// precede the await, since this module doesn't need to verify which filters
// were applied, only what loadCampaignAnalyticsSnapshot does with the rows.
function createFakeClient(tableRows: Record<string, unknown[]>): Client {
  function createChainable(rows: unknown[]) {
    const chainable = {
      select: () => chainable,
      eq: () => chainable,
      in: () => chainable,
      order: () => chainable,
      limit: () => chainable,
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return chainable;
  }
  const from = (table: string) => createChainable(tableRows[table] ?? []);
  return { from } as unknown as Client;
}

const CAMPAIGN = { id: "campaign-1", user_id: "user-1" } as unknown as Tables<"campaigns">;

const CAMPAIGN_LEADS = [{ id: "cl-1" }, { id: "cl-2" }];
const SEQUENCE = { id: "seq-1", campaign_id: "campaign-1", created_at: "2026-01-01T00:00:00Z" };
const SEQUENCE_STEPS = [
  {
    id: "step-1",
    sequence_id: "seq-1",
    step_order: 0,
    day_delay: 0,
    subject: "Step 1",
    body: "Hi there",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

function sentAttempt(id: string, campaignLeadId: string): Record<string, unknown> {
  return {
    id,
    campaign_lead_id: campaignLeadId,
    sequence_step_id: "step-1",
    status: "sent",
    attempt_count: 1,
    provider_message_id: `${id}@mail.example.com`,
    last_error: null,
    claimed_at: "2026-01-01T00:00:00Z",
    resolved_at: "2026-01-01T00:00:01Z",
    resolved_manually: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:01Z",
  };
}

describe("loadCampaignAnalyticsSnapshot", () => {
  it("computes non-null open/click rates from real opened/clicked email_events when the campaign has sent mail", async () => {
    const client = createFakeClient({
      campaign_leads: CAMPAIGN_LEADS,
      send_attempts: [sentAttempt("attempt-1", "cl-1"), sentAttempt("attempt-2", "cl-2")],
      email_events: [
        { event_type: "opened", metadata: { sequenceStepId: "step-1" } },
        { event_type: "clicked", metadata: { sequenceStepId: "step-1" } },
      ],
      analytics_events: [],
      sequences: [SEQUENCE],
      sequence_steps: SEQUENCE_STEPS,
    });

    const snapshot = await loadCampaignAnalyticsSnapshot(client, "org-1", CAMPAIGN);

    expect(snapshot.overview.sentCount).toBe(2);
    expect(snapshot.overview.openedCount).toBe(1);
    expect(snapshot.overview.clickedCount).toBe(1);
    // Batch 9C: denominator is sentCount, not deliveredCount (always 0 —
    // no 'delivered' producer exists) — see lib/analytics/campaign-metrics.ts.
    expect(snapshot.overview.openRate).toBe(50); // 1 / 2
    expect(snapshot.overview.clickRate).toBe(50); // 1 / 2
  });

  it("returns null open/click rates when the campaign hasn't sent anything yet", async () => {
    const client = createFakeClient({
      campaign_leads: CAMPAIGN_LEADS,
      send_attempts: [
        { ...sentAttempt("attempt-1", "cl-1"), status: "pending" },
        { ...sentAttempt("attempt-2", "cl-2"), status: "failed" },
      ],
      email_events: [{ event_type: "opened", metadata: { sequenceStepId: "step-1" } }],
      analytics_events: [],
      sequences: [SEQUENCE],
      sequence_steps: SEQUENCE_STEPS,
    });

    const snapshot = await loadCampaignAnalyticsSnapshot(client, "org-1", CAMPAIGN);

    expect(snapshot.overview.sentCount).toBe(0);
    expect(snapshot.overview.openRate).toBeNull();
    expect(snapshot.overview.clickRate).toBeNull();
  });

  it("returns zero counts and null rates for a brand-new campaign with no leads, sends, or events", async () => {
    const client = createFakeClient({
      campaign_leads: [],
      sequences: [],
    });

    const snapshot = await loadCampaignAnalyticsSnapshot(client, "org-1", CAMPAIGN);

    expect(snapshot.overview.sentCount).toBe(0);
    expect(snapshot.overview.openedCount).toBe(0);
    expect(snapshot.overview.clickedCount).toBe(0);
    expect(snapshot.overview.openRate).toBeNull();
    expect(snapshot.overview.clickRate).toBeNull();
  });
});
