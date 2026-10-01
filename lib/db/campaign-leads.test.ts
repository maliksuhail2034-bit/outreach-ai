import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import {
  addLeadsToCampaign,
  consumeSendNow,
  listCampaignLeadsForLead,
  listCampaignLeadsWithTimezones,
  markCampaignLeadBounced,
  removeCampaignLead,
  requestSendNow,
  updateClaimedCampaignLead,
} from "./campaign-leads";
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
    not: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "delete", "insert", "update", "eq", "order", "in", "not", "single", "maybeSingle"] as const) {
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

describe("requestSendNow", () => {
  function rpcClient(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(async () => result);
    return { client: { rpc } as unknown as Client, rpc };
  }

  it("calls request_send_now with only the lead id and reports success", async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });

    await expect(requestSendNow(client, "cl-1")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("request_send_now", { p_campaign_lead_id: "cl-1" });
  });

  it("reports a refusal (lead no longer eligible) as false", async () => {
    const { client } = rpcClient({ data: false, error: null });
    await expect(requestSendNow(client, "cl-1")).resolves.toBe(false);
  });

  it("throws on an RPC error", async () => {
    const { client } = rpcClient({ data: null, error: new Error("boom") });
    await expect(requestSendNow(client, "cl-1")).rejects.toThrow("boom");
  });
});

describe("consumeSendNow", () => {
  it("clears the bypass only where the row still holds this exact bypass for this step", async () => {
    const { client, chainable } = createMockClient({ data: [{ id: "cl-1" }], error: null });

    await expect(consumeSendNow(client, "cl-1", "step-1", "step-1")).resolves.toBe(true);
    expect(chainable.update).toHaveBeenCalledWith({ send_now_step_id: null });
    expect(chainable.eq.mock.calls).toEqual([
      ["id", "cl-1"],
      ["send_now_step_id", "step-1"],
      ["current_step_id", "step-1"],
    ]);
    expect(chainable.select).toHaveBeenCalledWith("id");
  });

  it("reports false when no row matched (the bypass was cleared, e.g. by a pause)", async () => {
    const { client } = createMockClient({ data: [], error: null });
    await expect(consumeSendNow(client, "cl-1", "step-1", "step-1")).resolves.toBe(false);
  });

  it("throws on a database error", async () => {
    const { client } = createMockClient({ data: null, error: new Error("boom") });
    await expect(consumeSendNow(client, "cl-1", "step-1", "step-1")).rejects.toThrow("boom");
  });
});

describe("updateClaimedCampaignLead", () => {
  it("writes only while the lead is still active on the expected step, in one conditional UPDATE", async () => {
    const { client, chainable } = createMockClient({ data: [{ id: "cl-1" }], error: null });

    await expect(
      updateClaimedCampaignLead(client, "cl-1", { status: "needs_review", locked_until: null }, "step-1"),
    ).resolves.toBe(true);
    expect(chainable.update).toHaveBeenCalledTimes(1);
    expect(chainable.update).toHaveBeenCalledWith({ status: "needs_review", locked_until: null });
    expect(chainable.eq.mock.calls).toEqual([
      ["id", "cl-1"],
      ["status", "active"],
      ["current_step_id", "step-1"],
    ]);
    expect(chainable.select).toHaveBeenCalledWith("id");
  });

  it("without an expected step, guards on status alone", async () => {
    const { client, chainable } = createMockClient({ data: [{ id: "cl-1" }], error: null });

    await updateClaimedCampaignLead(client, "cl-1", { status: "needs_review" });
    expect(chainable.eq.mock.calls).toEqual([
      ["id", "cl-1"],
      ["status", "active"],
    ]);
  });

  it("when the lead left 'active' since the claim, applies nothing but releases the lease", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await expect(
      updateClaimedCampaignLead(client, "cl-1", { status: "active", current_step_id: "step-2" }, "step-1"),
    ).resolves.toBe(false);
    expect(chainable.update.mock.calls).toEqual([
      [{ status: "active", current_step_id: "step-2" }],
      [{ locked_until: null }],
    ]);
    expect(chainable.eq.mock.calls.slice(3)).toEqual([["id", "cl-1"]]);
  });

  it("throws on a database error", async () => {
    const { client } = createMockClient({ data: null, error: new Error("boom") });
    await expect(updateClaimedCampaignLead(client, "cl-1", { status: "needs_review" })).rejects.toThrow("boom");
  });
});

// Batch G: launch and sending-window edits read each enrolled lead's
// timezone in the same query as the campaign_leads rows (no per-lead reads).
describe("markCampaignLeadBounced", () => {
  it("moves only an active or completed enrollment to bounced and stops scheduling, leaving the lease alone", async () => {
    const { client, chainable } = createMockClient({ data: [{ id: "campaign-lead-1" }], error: null });

    expect(await markCampaignLeadBounced(client, "campaign-lead-1")).toBe(true);

    expect(client.from).toHaveBeenCalledWith("campaign_leads");
    expect(chainable.update).toHaveBeenCalledWith({ status: "bounced", next_send_at: null });
    expect(chainable.eq).toHaveBeenCalledWith("id", "campaign-lead-1");
    expect(chainable.in).toHaveBeenCalledWith("status", ["active", "completed"]);
  });

  it("returns false when the enrollment is in any other state (nothing matched)", async () => {
    const { client } = createMockClient({ data: [], error: null });
    expect(await markCampaignLeadBounced(client, "campaign-lead-1")).toBe(false);
  });

  it("throws on a query error", async () => {
    const { client } = createMockClient({ data: null, error: new Error("boom") });
    await expect(markCampaignLeadBounced(client, "campaign-lead-1")).rejects.toThrow("boom");
  });
});

describe("listCampaignLeadsWithTimezones", () => {
  it("reads the lead timezone in the same query and flattens it onto each row", async () => {
    const rows = [
      { id: "cl-1", campaign_id: "campaign-1", status: "active", lead: { timezone: "America/New_York" } },
      { id: "cl-2", campaign_id: "campaign-1", status: "active", lead: { timezone: null } },
      { id: "cl-3", campaign_id: "campaign-1", status: "active", lead: null },
    ];
    const { client, chainable } = createMockClient({ data: rows, error: null });

    const result = await listCampaignLeadsWithTimezones(client, "campaign-1", { status: "active" });

    expect(client.from).toHaveBeenCalledTimes(1);
    expect(chainable.select).toHaveBeenCalledWith("*, lead:leads(timezone)");
    expect(chainable.eq).toHaveBeenCalledWith("campaign_id", "campaign-1");
    expect(chainable.eq).toHaveBeenCalledWith("status", "active");
    expect(result).toEqual([
      { id: "cl-1", campaign_id: "campaign-1", status: "active", leadTimezone: "America/New_York" },
      { id: "cl-2", campaign_id: "campaign-1", status: "active", leadTimezone: null },
      { id: "cl-3", campaign_id: "campaign-1", status: "active", leadTimezone: null },
    ]);
  });

  it("throws when the read errors", async () => {
    const { client } = createMockClient({ data: null, error: new Error("connection lost") });
    await expect(listCampaignLeadsWithTimezones(client, "campaign-1")).rejects.toThrow("connection lost");
  });
});
