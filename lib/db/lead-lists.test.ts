import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { listLeadListsWithCounts } from "./lead-lists";

// Same fake-Client pattern as lib/db/leads.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "eq", "order"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable, from };
}

function listRow(id: string, leads: unknown) {
  return {
    id,
    user_id: "user-1",
    name: `List ${id}`,
    description: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    leads,
  };
}

describe("listLeadListsWithCounts", () => {
  it("returns each list with its own exact lead count, in the query's order", async () => {
    const { client } = createMockClient({
      data: [listRow("a", [{ count: 40 }]), listRow("b", [{ count: 3 }]), listRow("c", [{ count: 0 }])],
      error: null,
    });

    const lists = await listLeadListsWithCounts(client, "user-1");

    expect(lists.map((list) => [list.id, list.leadCount])).toEqual([
      ["a", 40],
      ["b", 3],
      ["c", 0],
    ]);
  });

  it("keeps the lead_lists row shape LeadListsPanel expects, plus leadCount and without the embedded leads", async () => {
    const { client } = createMockClient({ data: [listRow("a", [{ count: 2 }])], error: null });

    const [list] = await listLeadListsWithCounts(client, "user-1");

    expect(list).toEqual({
      id: "a",
      user_id: "user-1",
      name: "List a",
      description: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      leadCount: 2,
    });
    expect(list).not.toHaveProperty("leads");
  });

  it.each([
    ["an empty embedded count", []],
    ["a missing embedded count", null],
    ["an embed with no count field", [{}]],
  ])("treats %s as 0", async (_label, leads) => {
    const { client } = createMockClient({ data: [listRow("empty", leads)], error: null });

    expect((await listLeadListsWithCounts(client, "user-1"))[0].leadCount).toBe(0);
  });

  it("returns [] when the user has no lists", async () => {
    const { client } = createMockClient({ data: [], error: null });

    expect(await listLeadListsWithCounts(client, "user-1")).toEqual([]);
  });

  it("reads lists and counts in a single query scoped to the user, newest first", async () => {
    const { client, chainable, from } = createMockClient({
      data: Array.from({ length: 50 }, (_, index) => listRow(`list-${index}`, [{ count: index }])),
      error: null,
    });

    const lists = await listLeadListsWithCounts(client, "user-1");

    expect(lists).toHaveLength(50);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("lead_lists");
    expect(chainable.select).toHaveBeenCalledTimes(1);
    expect(chainable.select).toHaveBeenCalledWith("*, leads(count)");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("propagates a query error", async () => {
    const { client } = createMockClient({ data: null, error: new Error("connection lost") });

    await expect(listLeadListsWithCounts(client, "user-1")).rejects.toThrow("connection lost");
  });
});
