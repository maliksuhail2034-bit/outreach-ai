import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import { processUnsubscribe } from "./unsubscribe";

// A richer version of Task 1's fake-Client pattern (lib/db/suppressions.test.ts):
// processUnsubscribe touches five tables (campaign_leads, campaigns, leads,
// suppressions, email_events), so this keys a separate chainable mock per
// table instead of one shared one, letting each table return its own
// canned result and be asserted on independently.
function createMockClient(tableResults: Record<string, { data?: unknown; error?: unknown }>) {
  const chainablesByTable: Record<string, ReturnType<typeof createChainable>> = {};

  function createChainable(result: { data?: unknown; error?: unknown }) {
    const chainable = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
      maybeSingle: vi.fn(),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    for (const method of ["select", "insert", "update", "delete", "eq", "single", "maybeSingle"] as const) {
      chainable[method].mockReturnValue(chainable);
    }
    return chainable;
  }

  const from = vi.fn((table: string) => {
    if (!chainablesByTable[table]) {
      chainablesByTable[table] = createChainable(tableResults[table] ?? { data: null, error: null });
    }
    return chainablesByTable[table];
  });

  const client = { from } as unknown as Client;
  return { client, chainablesByTable };
}

const campaignLeadRow = {
  id: "cl-1",
  campaign_id: "campaign-1",
  lead_id: "lead-1",
  mailbox_id: "mailbox-1",
  status: "active",
};
const campaignRow = { id: "campaign-1", user_id: "user-1" };
const leadRow = { id: "lead-1", email: "prospect@example.com" };

describe("processUnsubscribe", () => {
  it("suppresses the address, stops the enrollment, and records the event on success", async () => {
    const { client, chainablesByTable } = createMockClient({
      campaign_leads: { data: campaignLeadRow, error: null },
      campaigns: { data: campaignRow, error: null },
      leads: { data: leadRow, error: null },
      suppressions: { data: null, error: null },
      email_events: { data: {}, error: null },
    });

    const result = await processUnsubscribe(client, "cl-1");

    expect(result).toEqual({ ok: true, email: "prospect@example.com" });

    expect(chainablesByTable.suppressions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", email: "prospect@example.com", reason: "unsubscribed" }),
    );
    expect(chainablesByTable.campaign_leads.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unsubscribed", next_send_at: null, locked_until: null }),
    );
    expect(chainablesByTable.email_events.insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "unsubscribed", campaign_id: "campaign-1", lead_id: "lead-1" }),
    );
  });

  it("returns a friendly error instead of throwing when the campaign_lead no longer exists", async () => {
    const { client } = createMockClient({
      campaign_leads: { data: null, error: { message: "not found" } },
    });

    const result = await processUnsubscribe(client, "does-not-exist");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no longer valid/i);
    }
  });
});
