import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { listCampaignsPage } from "./campaigns";

// Scalability Track, Phase D, Step 3 (item 9) — mirrors lib/db/leads.test.ts's
// listLeadsPage suite exactly; both functions share the same shape.
describe("listCampaignsPage", () => {
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

    await listCampaignsPage(client, "user-1", { page: 3, pageSize: 20 });

    expect(chain.range).toHaveBeenCalledWith(40, 59);
  });

  it("defaults to page 1 and the default page size", async () => {
    const { client, chain } = createClient({ data: [], error: null, count: 0 });

    const result = await listCampaignsPage(client, "user-1");

    expect(chain.range).toHaveBeenCalledWith(0, 99);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it("returns the page of rows and the total count together", async () => {
    const { client } = createClient({ data: [{ id: "campaign-1" }], error: null, count: 42 });

    const result = await listCampaignsPage(client, "user-1", { page: 1, pageSize: 10 });

    expect(result).toEqual({ campaigns: [{ id: "campaign-1" }], page: 1, pageSize: 10, totalCount: 42 });
  });

  it("clamps a page below 1 up to 1", async () => {
    const { client, chain } = createClient({ data: [], error: null, count: 0 });

    const result = await listCampaignsPage(client, "user-1", { page: 0 });

    expect(result.page).toBe(1);
    expect(chain.range).toHaveBeenCalledWith(0, 99);
  });

  it("throws when the query errors", async () => {
    const { client } = createClient({ data: null, error: new Error("connection lost"), count: null });
    await expect(listCampaignsPage(client, "user-1")).rejects.toThrow("connection lost");
  });

  // Confirmed live against the real linked project (Scalability Track,
  // Phase D, Step 3): PostgREST rejects an out-of-range .range() offset
  // outright (HTTP 416, error code PGRST103) instead of returning zero
  // rows.
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
      .mockReturnValueOnce(makeChain({ data: null, error: null, count: 3 }))
      .mockReturnValueOnce(makeChain({ data: [{ id: "campaign-1" }], error: null, count: 3 }));
    const client = { from } as unknown as Client;

    const result = await listCampaignsPage(client, "user-1", { page: 50, pageSize: 100 });

    expect(result).toEqual({ campaigns: [{ id: "campaign-1" }], page: 1, pageSize: 100, totalCount: 3 });
    expect(from).toHaveBeenCalledTimes(3);
  });
});
