import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { addCampaignMailbox, listCampaignMailboxes, removeCampaignMailbox } from "./campaign-mailboxes";

// Same fake-Client pattern as lib/db/campaign-leads.test.ts / lib/db/warmup.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "delete", "eq", "order", "single"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listCampaignMailboxes", () => {
  it("scopes to the campaign and orders by created_at ascending, for deterministic round-robin", async () => {
    const rows = [{ id: "cm-1", campaign_id: "campaign-1", mailbox_id: "mailbox-1", created_at: "2026-01-01T00:00:00Z" }];
    const { client, chainable } = createMockClient({ data: rows, error: null });

    const result = await listCampaignMailboxes(client, "campaign-1");

    expect(client.from).toHaveBeenCalledWith("campaign_mailboxes");
    expect(chainable.eq).toHaveBeenCalledWith("campaign_id", "campaign-1");
    expect(chainable.order).toHaveBeenCalledWith("created_at", { ascending: true });
    // Secondary sort key on id — created_at alone isn't unique, so this
    // tiebreaker is what keeps round-robin order deterministic across ties.
    expect(chainable.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(result).toEqual(rows);
  });

  it("returns an empty array rather than null when the pool is empty", async () => {
    const { client } = createMockClient({ data: null, error: null });
    const result = await listCampaignMailboxes(client, "campaign-1");
    expect(result).toEqual([]);
  });
});

describe("addCampaignMailbox", () => {
  it("inserts the (campaign_id, mailbox_id) pair and returns the created row", async () => {
    const row = { id: "cm-1", campaign_id: "campaign-1", mailbox_id: "mailbox-1", created_at: "2026-01-01T00:00:00Z" };
    const { client, chainable } = createMockClient({ data: row, error: null });

    const result = await addCampaignMailbox(client, "campaign-1", "mailbox-1");

    expect(client.from).toHaveBeenCalledWith("campaign_mailboxes");
    expect(chainable.insert).toHaveBeenCalledWith({ campaign_id: "campaign-1", mailbox_id: "mailbox-1" });
    expect(result).toEqual(row);
  });
});

describe("removeCampaignMailbox", () => {
  it("deletes by the (campaign_id, mailbox_id) natural key", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await removeCampaignMailbox(client, "campaign-1", "mailbox-1");

    expect(client.from).toHaveBeenCalledWith("campaign_mailboxes");
    expect(chainable.delete).toHaveBeenCalled();
    expect(chainable.eq).toHaveBeenCalledWith("campaign_id", "campaign-1");
    expect(chainable.eq).toHaveBeenCalledWith("mailbox_id", "mailbox-1");
  });

  it("throws when the delete errors", async () => {
    const { client } = createMockClient({ error: new Error("not found") });
    await expect(removeCampaignMailbox(client, "campaign-1", "mailbox-1")).rejects.toThrow("not found");
  });
});
