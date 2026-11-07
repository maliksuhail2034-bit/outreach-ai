import { describe, expect, it } from "vitest";
import type { Client } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { loadCampaignAnalyticsSnapshot } from "./campaign-analytics";

// loadCampaignAnalyticsSnapshot reads its counts from campaign_engagement()
// (unique people, bots excluded) and only analytics_events / the sequence
// from tables. Every table query resolves to the rows given for it.
function createFakeClient(tableRows: Record<string, unknown[]>, engagement: unknown): Client {
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
  return {
    from: (table: string) => createChainable(tableRows[table] ?? []),
    rpc: async (name: string) => {
      if (name !== "campaign_engagement") throw new Error(`unexpected rpc ${name}`);
      return { data: engagement, error: null };
    },
  } as unknown as Client;
}

const CAMPAIGN = { id: "campaign-1", user_id: "user-1" } as unknown as Tables<"campaigns">;
const SEQUENCE = { id: "seq-1", campaign_id: "campaign-1", created_at: "2026-01-01T00:00:00Z" };
const SEQUENCE_STEPS = [{ id: "step-1", sequence_id: "seq-1", step_order: 0, subject: "Step 1" }];

function engagement(overrides: Record<string, unknown> = {}) {
  return {
    emails_sent: 0,
    leads_contacted: 0,
    unique_opened: 0,
    unique_clicked: 0,
    unique_replied: 0,
    unique_bounced: 0,
    unique_unsubscribed: 0,
    bot_opens: 0,
    bot_clicks: 0,
    steps: [],
    ...overrides,
  };
}

describe("loadCampaignAnalyticsSnapshot", () => {
  it("rates unique people out of the people emailed, never emails out of emails", async () => {
    const client = createFakeClient(
      { analytics_events: [], sequences: [SEQUENCE], sequence_steps: SEQUENCE_STEPS },
      // 4 emails to 2 people; 2 people opened (however many times), 1 clicked.
      engagement({ emails_sent: 4, leads_contacted: 2, unique_opened: 2, unique_clicked: 1, unique_replied: 1 }),
    );

    const snapshot = await loadCampaignAnalyticsSnapshot(client, "org-1", CAMPAIGN);

    expect(snapshot.overview).toMatchObject({
      sentCount: 4,
      openedCount: 2,
      clickedCount: 1,
      openRate: 100,
      clickRate: 50,
      replyRate: 50,
    });
  });

  it("returns null rates when the campaign hasn't sent anything yet", async () => {
    const client = createFakeClient({ analytics_events: [], sequences: [SEQUENCE], sequence_steps: SEQUENCE_STEPS }, engagement());

    const snapshot = await loadCampaignAnalyticsSnapshot(client, "org-1", CAMPAIGN);

    expect(snapshot.overview.sentCount).toBe(0);
    expect(snapshot.overview.openRate).toBeNull();
    expect(snapshot.overview.clickRate).toBeNull();
  });

  it("fails loudly on an engagement shape it doesn't understand", async () => {
    const client = createFakeClient({ sequences: [] }, { emails_sent: "lots" });
    await expect(loadCampaignAnalyticsSnapshot(client, "org-1", CAMPAIGN)).rejects.toThrow();
  });
});
