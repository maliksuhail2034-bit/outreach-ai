import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { deleteLead } from "./leads";

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
    limit: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "delete", "insert", "update", "eq", "order", "in", "limit", "single"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

// deleteLead is the permanent-deletion path wired into the campaign lead UI
// (see deleteLeadPermanentlyAction) — it deletes only the leads row itself.
// Every campaign_leads/email_events/send_attempts row referencing it is
// removed by the database via "on delete cascade" (confirmed directly in
// the migrations, not re-tested here since it's DB behavior, not app code),
// and suppressions rows are untouched since they're keyed by email, not
// lead_id.
describe("deleteLead", () => {
  it("scopes the delete to both the owning user and the lead id", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await deleteLead(client, "user-1", "lead-1");

    expect(client.from).toHaveBeenCalledWith("leads");
    expect(chainable.delete).toHaveBeenCalled();
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.eq).toHaveBeenCalledWith("id", "lead-1");
  });

  it("resolves without throwing on success", async () => {
    const { client } = createMockClient({ error: null });
    await expect(deleteLead(client, "user-1", "lead-1")).resolves.toBeUndefined();
  });

  it("throws when the delete errors", async () => {
    const { client } = createMockClient({ error: new Error("connection lost") });
    await expect(deleteLead(client, "user-1", "lead-1")).rejects.toThrow("connection lost");
  });
});
