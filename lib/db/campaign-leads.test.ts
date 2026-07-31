import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { removeCampaignLead } from "./campaign-leads";

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
