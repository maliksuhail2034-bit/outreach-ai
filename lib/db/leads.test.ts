import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { createLeadsBatch, deleteLead, listLeadsAvailableForCampaign, listLeadsPage } from "./leads";

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

// Scalability Track, Phase B (item 7) — pushes the "not yet enrolled"
// filter into SQL instead of diffing a full account-wide lead fetch
// against every campaign_leads row in JS.
describe("listLeadsAvailableForCampaign", () => {
  function createClient(
    enrolledResult: { data?: unknown; error?: unknown },
    leadsResult: { data?: unknown; error?: unknown },
  ) {
    const campaignLeadsChain = {
      select: vi.fn(),
      eq: vi.fn(),
      then: (resolve: (value: typeof enrolledResult) => void) => resolve(enrolledResult),
    };
    for (const method of ["select", "eq"] as const) {
      campaignLeadsChain[method].mockReturnValue(campaignLeadsChain);
    }

    const leadsChain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      not: vi.fn(),
      then: (resolve: (value: typeof leadsResult) => void) => resolve(leadsResult),
    };
    for (const method of ["select", "eq", "order", "limit", "not"] as const) {
      leadsChain[method].mockReturnValue(leadsChain);
    }

    const from = vi.fn((table: string) => (table === "campaign_leads" ? campaignLeadsChain : leadsChain));
    const client = { from } as unknown as Client;
    return { client, campaignLeadsChain, leadsChain };
  }

  it("excludes already-enrolled lead ids via a not-in filter", async () => {
    const { client, leadsChain } = createClient(
      { data: [{ lead_id: "lead-1" }, { lead_id: "lead-2" }], error: null },
      { data: [{ id: "lead-3" }], error: null },
    );

    const result = await listLeadsAvailableForCampaign(client, "user-1", "campaign-1");

    expect(leadsChain.not).toHaveBeenCalledWith("id", "in", "(lead-1,lead-2)");
    expect(leadsChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual([{ id: "lead-3" }]);
  });

  it("skips the not-in filter when no leads are enrolled yet", async () => {
    const { client, leadsChain } = createClient({ data: [], error: null }, { data: [], error: null });

    await listLeadsAvailableForCampaign(client, "user-1", "campaign-1");

    expect(leadsChain.not).not.toHaveBeenCalled();
  });

  it("throws when resolving enrolled leads errors", async () => {
    const { client } = createClient({ data: null, error: new Error("boom") }, { data: [], error: null });
    await expect(listLeadsAvailableForCampaign(client, "user-1", "campaign-1")).rejects.toThrow("boom");
  });
});

// Scalability Track, Phase B (item 8).
describe("listLeadsPage", () => {
  function createClient(result: { data?: unknown; error?: unknown; count?: number | null }) {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    for (const method of ["select", "eq", "order", "range"] as const) {
      chain[method].mockReturnValue(chain);
    }
    const from = vi.fn(() => chain);
    const client = { from } as unknown as Client;
    return { client, chain };
  }

  it("computes the correct range for a given page and page size", async () => {
    const { client, chain } = createClient({ data: [], error: null, count: 0 });

    await listLeadsPage(client, "user-1", { page: 3, pageSize: 20 });

    expect(chain.range).toHaveBeenCalledWith(40, 59);
  });

  it("defaults to page 1 and the default page size", async () => {
    const { client, chain } = createClient({ data: [], error: null, count: 0 });

    const result = await listLeadsPage(client, "user-1");

    expect(chain.range).toHaveBeenCalledWith(0, 99);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it("returns the page of rows and the total count together", async () => {
    const { client } = createClient({ data: [{ id: "lead-1" }], error: null, count: 42 });

    const result = await listLeadsPage(client, "user-1", { page: 1, pageSize: 10 });

    expect(result).toEqual({ leads: [{ id: "lead-1" }], page: 1, pageSize: 10, totalCount: 42 });
  });

  it("clamps a page below 1 up to 1", async () => {
    const { client, chain } = createClient({ data: [], error: null, count: 0 });

    const result = await listLeadsPage(client, "user-1", { page: 0 });

    expect(result.page).toBe(1);
    expect(chain.range).toHaveBeenCalledWith(0, 99);
  });

  it("throws when the query errors", async () => {
    const { client } = createClient({ data: null, error: new Error("connection lost"), count: null });
    await expect(listLeadsPage(client, "user-1")).rejects.toThrow("connection lost");
  });

  // Confirmed live against the real linked project (Scalability Track,
  // Phase D, Step 3): PostgREST rejects an out-of-range .range() offset
  // outright (HTTP 416, error code PGRST103) instead of returning zero
  // rows -- a stale/bookmarked page number crashed the page in the browser
  // before this fallback existed.
  function makeChain(result: { data: unknown; error: unknown; count: unknown }) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    return chain;
  }

  it("falls back to the last real page when the requested page is out of range (PGRST103)", async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(
        makeChain({ data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null }),
      )
      .mockReturnValueOnce(makeChain({ data: null, error: null, count: 5 }))
      .mockReturnValueOnce(makeChain({ data: [{ id: "lead-1" }], error: null, count: 5 }));
    const client = { from } as unknown as Client;

    const result = await listLeadsPage(client, "user-1", { page: 99, pageSize: 100 });

    expect(result).toEqual({ leads: [{ id: "lead-1" }], page: 1, pageSize: 100, totalCount: 5 });
    expect(from).toHaveBeenCalledTimes(3);
  });

  it("re-throws a non-PGRST103 error even from the fallback path shape", async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(makeChain({ data: null, error: { code: "PGRST103" }, count: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: new Error("db unavailable"), count: null }));
    const client = { from } as unknown as Client;

    await expect(listLeadsPage(client, "user-1", { page: 99 })).rejects.toThrow("db unavailable");
  });
});

// Scalability Track, Phase B (item 10) — build only, not yet called from
// app/(app)/leads/import-actions.ts.
describe("createLeadsBatch", () => {
  function makeChain(result: { data: unknown; error: unknown }) {
    const chain = {
      insert: vi.fn(() => chain),
      select: vi.fn(() => chain),
      single: vi.fn(() => chain),
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    return chain;
  }

  it("returns empty results for an empty input array without querying", async () => {
    const from = vi.fn();
    const client = { from } as unknown as Client;

    const result = await createLeadsBatch(client, []);

    expect(result).toEqual({ created: [], failedIndexes: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts a chunk in a single call when the bulk insert succeeds", async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(makeChain({ data: [{ id: "lead-1" }, { id: "lead-2" }], error: null }));
    const client = { from } as unknown as Client;

    const result = await createLeadsBatch(client, [
      { user_id: "user-1", email: "a@example.com" },
      { user_id: "user-1", email: "b@example.com" },
    ]);

    expect(result).toEqual({ created: [{ id: "lead-1" }, { id: "lead-2" }], failedIndexes: [] });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("falls back to per-row inserts when the bulk insert fails, attributing failures by index", async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(makeChain({ data: null, error: new Error("bulk insert failed") }))
      .mockReturnValueOnce(makeChain({ data: { id: "lead-1" }, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: new Error("duplicate email") }));
    const client = { from } as unknown as Client;

    const result = await createLeadsBatch(client, [
      { user_id: "user-1", email: "a@example.com" },
      { user_id: "user-1", email: "b@example.com" },
    ]);

    expect(result.created).toEqual([{ id: "lead-1" }]);
    expect(result.failedIndexes).toEqual([1]);
    expect(from).toHaveBeenCalledTimes(3);
  });

  it("splits large inputs into multiple chunks", async () => {
    const values = Array.from({ length: 501 }, (_, i) => ({ user_id: "user-1", email: `lead${i}@example.com` }));
    const from = vi
      .fn()
      .mockReturnValueOnce(
        makeChain({ data: values.slice(0, 500).map((_, i) => ({ id: `id-${i}` })), error: null }),
      )
      .mockReturnValueOnce(makeChain({ data: [{ id: "id-500" }], error: null }));
    const client = { from } as unknown as Client;

    const result = await createLeadsBatch(client, values);

    expect(from).toHaveBeenCalledTimes(2);
    expect(result.created).toHaveLength(501);
    expect(result.failedIndexes).toEqual([]);
  });
});
