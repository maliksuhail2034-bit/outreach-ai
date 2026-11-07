import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  listAllCrmLeads: vi.fn(),
  listLeadSegments: vi.fn(),
  listLeadsByIds: vi.fn(),
}));

import { listAllCrmLeads, listLeadSegments, listLeadsByIds } from "@/lib/db";
import type { Client } from "@/lib/db/shared";
import { parseCrmSearchParams } from "@/lib/validations/crm-leads";
import { resolveBulkLeads, resolveCrmFilters } from "./crm-filters";

const SUPABASE = {} as Client;
const SEGMENT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listLeadSegments).mockResolvedValue([
    { id: SEGMENT, name: "Founders", rules: [{ field: "title", operator: "contains", value: "founder" }] },
  ] as never);
  vi.mocked(listAllCrmLeads).mockResolvedValue([{ id: "lead-1" }] as never);
  vi.mocked(listLeadsByIds).mockResolvedValue([{ id: "lead-2" }] as never);
});

describe("resolveCrmFilters", () => {
  it("applies a valid segment's rules", async () => {
    const result = await resolveCrmFilters(SUPABASE, "user-1", parseCrmSearchParams({ segment: SEGMENT, engagement: "opened" }));
    expect(result.activeSegment).toEqual({ id: SEGMENT, name: "Founders" });
    expect(result.filters).toMatchObject({ engagement: "opened", rules: [{ field: "title", operator: "contains", value: "founder" }] });
    expect(result.segmentNotice).toBeUndefined();
  });

  it("explains a missing or invalid segment and applies no rules", async () => {
    vi.mocked(listLeadSegments).mockResolvedValue([{ id: SEGMENT, name: "Broken", rules: [{ field: "nope" }] }] as never);
    const invalid = await resolveCrmFilters(SUPABASE, "user-1", parseCrmSearchParams({ segment: SEGMENT }));
    expect(invalid.filters.rules).toBeUndefined();
    expect(invalid.segmentNotice).toMatch(/no longer valid/);

    vi.mocked(listLeadSegments).mockResolvedValue([]);
    const missing = await resolveCrmFilters(SUPABASE, "user-1", parseCrmSearchParams({ segment: SEGMENT }));
    expect(missing.segmentNotice).toMatch(/wasn't found/);
  });
});

describe("resolveBulkLeads", () => {
  it("reads ticked ids scoped to the caller", async () => {
    expect(await resolveBulkLeads(SUPABASE, "user-1", { ids: ["lead-2"] })).toEqual([{ id: "lead-2" }]);
    expect(listLeadsByIds).toHaveBeenCalledWith(SUPABASE, "user-1", ["lead-2"]);
  });

  it("reads every lead matching the page's query, parsed like the page does, capped", async () => {
    await resolveBulkLeads(SUPABASE, "user-1", { query: `engagement=not_opened&campaign=${CAMPAIGN}&page=4&sort=opens` });
    expect(listAllCrmLeads).toHaveBeenCalledWith(
      SUPABASE,
      "user-1",
      expect.objectContaining({ engagement: "not_opened", campaignId: CAMPAIGN, sort: "opens" }),
      10000,
    );
  });

  it("matches nothing (never every lead) when the query's segment can't be applied", async () => {
    vi.mocked(listLeadSegments).mockResolvedValue([]);
    expect(await resolveBulkLeads(SUPABASE, "user-1", { query: `segment=${SEGMENT}` })).toEqual([]);
    expect(listAllCrmLeads).not.toHaveBeenCalled();
  });
});
