import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { addLeadsToCampaign, listCampaignLeadsForLead, removeCampaignLead } from "./campaign-leads";
import type { Tables } from "@/types/database.types";

// Same fake-Client pattern as lib/db/suppressions.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "delete", "insert", "update", "eq", "order", "in", "single", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listCampaignLeadsForLead", () => {
  it("scopes the query to the given lead_id, newest first", async () => {
    const rows = [{ id: "campaign-lead-1", lead_id: "lead-1" }];
    const { client, chainable } = createMockClient({ data: rows, error: null });

    const result = await listCampaignLeadsForLead(client, "lead-1");

    expect(client.from).toHaveBeenCalledWith("campaign_leads");
    expect(chainable.eq).toHaveBeenCalledWith("lead_id", "lead-1");
    expect(chainable.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result).toEqual(rows);
  });

  it("returns an empty array when the lead has no enrollments", async () => {
    const { client } = createMockClient({ data: [], error: null });
    expect(await listCampaignLeadsForLead(client, "lead-1")).toEqual([]);
  });

  it("throws on a query error", async () => {
    const { client } = createMockClient({ data: null, error: new Error("boom") });
    await expect(listCampaignLeadsForLead(client, "lead-1")).rejects.toThrow("boom");
  });
});

describe("removeCampaignLead", () => {
  it("deletes the enrollment by id, leaving the lead itself untouched", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await removeCampaignLead(client, "campaign-lead-1");

    expect(client.from).toHaveBeenCalledWith("campaign_leads");
    expect(chainable.delete).toHaveBeenCalled();
    expect(chainable.eq).toHaveBeenCalledWith("id", "campaign-lead-1");
  });

  it("resolves without throwing on success", async () => {
    const { client } = createMockClient({ error: null });
    await expect(removeCampaignLead(client, "campaign-lead-1")).resolves.toBeUndefined();
  });

  it("throws when the delete errors", async () => {
    const { client } = createMockClient({ error: new Error("not found") });
    await expect(removeCampaignLead(client, "campaign-lead-1")).rejects.toThrow("not found");
  });
});

// Batch 8: addLeadsToCampaign's mailboxId param became a per-lead resolver
// so bulk enrollment can round-robin across a pool — these tests exercise
// the two sequential queries (existing-row dedup lookup, then the insert)
// against a client whose `.from()` returns a different chainable per call.
function createAddLeadsClient(existingRows: { lead_id: string }[], insertedRows: Tables<"campaign_leads">[]) {
  const existingChainable = {
    select: vi.fn(),
    eq: vi.fn(),
    then: (resolve: (value: { data: typeof existingRows; error: null }) => void) =>
      resolve({ data: existingRows, error: null }),
  };
  existingChainable.select.mockReturnValue(existingChainable);
  existingChainable.eq.mockReturnValue(existingChainable);

  const insertChainable = {
    insert: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: { data: typeof insertedRows; error: null }) => void) =>
      resolve({ data: insertedRows, error: null }),
  };
  insertChainable.insert.mockReturnValue(insertChainable);
  insertChainable.select.mockReturnValue(insertChainable);

  const from = vi.fn().mockReturnValueOnce(existingChainable).mockReturnValueOnce(insertChainable);
  const client = { from } as unknown as Client;
  return { client, existingChainable, insertChainable };
}

describe("addLeadsToCampaign", () => {
  it("reproduces the prior single-mailbox behavior when the resolver always returns the same value", async () => {
    const { client, insertChainable } = createAddLeadsClient([], []);
    const resolveMailboxId = vi.fn(() => "mailbox-default");

    await addLeadsToCampaign(client, "campaign-1", ["lead-1", "lead-2"], resolveMailboxId);

    expect(insertChainable.insert).toHaveBeenCalledWith([
      { campaign_id: "campaign-1", lead_id: "lead-1", mailbox_id: "mailbox-default" },
      { campaign_id: "campaign-1", lead_id: "lead-2", mailbox_id: "mailbox-default" },
    ]);
  });

  it("passes each newly-inserted lead's enrollment index, offset by the existing enrolled count", async () => {
    const { client, insertChainable } = createAddLeadsClient([{ lead_id: "already-here" }], []);
    const resolveMailboxId = vi.fn((index: number) => `mailbox-${index}`);

    await addLeadsToCampaign(client, "campaign-1", ["lead-a", "lead-b", "lead-c"], resolveMailboxId);

    // existing count is 1, so the three new leads get indices 1, 2, 3 —
    // round-robin distribution across a pool, in the given order.
    expect(resolveMailboxId).toHaveBeenNthCalledWith(1, 1);
    expect(resolveMailboxId).toHaveBeenNthCalledWith(2, 2);
    expect(resolveMailboxId).toHaveBeenNthCalledWith(3, 3);
    expect(insertChainable.insert).toHaveBeenCalledWith([
      { campaign_id: "campaign-1", lead_id: "lead-a", mailbox_id: "mailbox-1" },
      { campaign_id: "campaign-1", lead_id: "lead-b", mailbox_id: "mailbox-2" },
      { campaign_id: "campaign-1", lead_id: "lead-c", mailbox_id: "mailbox-3" },
    ]);
  });

  it("never calls the resolver for a lead already enrolled, and excludes it from the index sequence", async () => {
    const { client, insertChainable } = createAddLeadsClient([{ lead_id: "lead-a" }], []);
    const resolveMailboxId = vi.fn((index: number) => `mailbox-${index}`);

    const result = await addLeadsToCampaign(client, "campaign-1", ["lead-a", "lead-b"], resolveMailboxId);

    expect(resolveMailboxId).toHaveBeenCalledTimes(1);
    expect(resolveMailboxId).toHaveBeenCalledWith(1);
    expect(insertChainable.insert).toHaveBeenCalledWith([
      { campaign_id: "campaign-1", lead_id: "lead-b", mailbox_id: "mailbox-1" },
    ]);
    expect(result.skipped).toBe(1);
  });

  it("skips the insert entirely (and never calls the resolver) when every lead is already enrolled", async () => {
    const { client, insertChainable } = createAddLeadsClient([{ lead_id: "lead-a" }], []);
    const resolveMailboxId = vi.fn(() => "mailbox-x");

    const result = await addLeadsToCampaign(client, "campaign-1", ["lead-a"], resolveMailboxId);

    expect(resolveMailboxId).not.toHaveBeenCalled();
    expect(insertChainable.insert).not.toHaveBeenCalled();
    expect(result).toEqual({ inserted: 0, skipped: 1, rows: [] });
  });
});
