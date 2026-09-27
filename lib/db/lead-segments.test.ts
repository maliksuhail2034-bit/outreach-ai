import { describe, expect, it, vi } from "vitest";
import type { LeadSegmentRule } from "@/lib/validations/lead-segments";
import type { Client } from "./shared";
import {
  applySegmentRules,
  countLeadsMatchingRules,
  createLeadSegment,
  deleteLeadSegment,
  escapeLikePattern,
  getLeadSegment,
  listLeadSegments,
  listLeadsMatchingRules,
  updateLeadSegment,
  type LeadsQuery,
} from "./lead-segments";

type Call = [method: string, ...args: unknown[]];

// Records every builder call in order, so a test can assert the exact
// filters a rule produces — the only thing that ever reaches PostgREST.
function createRecordingClient(result: { data?: unknown; error?: unknown; count?: number | null } = {}) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "neq", "in", "ilike", "lt", "gte", "order", "limit", "single"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: null, count: null, ...result });
  const from = vi.fn((table: string) => {
    calls.push(["from", table]);
    return chain;
  });
  return { client: { from } as unknown as Client, calls, chain: chain as unknown as LeadsQuery };
}

function filtersFor(rules: LeadSegmentRule[]) {
  const { chain, calls } = createRecordingClient();
  applySegmentRules(chain, rules);
  return calls;
}

const LIST_A = "11111111-1111-4111-8111-111111111111";

describe("escapeLikePattern", () => {
  it("escapes ILIKE wildcards and the escape character itself", () => {
    expect(escapeLikePattern("100%_off")).toBe("100\\%\\_off");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("plain text")).toBe("plain text");
  });
});

describe("applySegmentRules — filter generation", () => {
  it("maps status/verification operators to eq / neq / in / chained neq", () => {
    expect(filtersFor([{ field: "status", operator: "is", value: "new" }])).toEqual([["eq", "status", "new"]]);
    expect(filtersFor([{ field: "status", operator: "is_not", value: "replied" }])).toEqual([["neq", "status", "replied"]]);
    expect(filtersFor([{ field: "verification_status", operator: "in", values: ["valid", "catch_all"] }])).toEqual([
      ["in", "verification_status", ["valid", "catch_all"]],
    ]);
    // not_in uses one typed neq per value — no hand-built not.in.(...) string.
    expect(filtersFor([{ field: "verification_status", operator: "not_in", values: ["invalid", "error"] }])).toEqual([
      ["neq", "verification_status", "invalid"],
      ["neq", "verification_status", "error"],
    ]);
  });

  it("maps list rules to an in-filter on list_id", () => {
    expect(filtersFor([{ field: "list_id", operator: "in", values: [LIST_A] }])).toEqual([["in", "list_id", [LIST_A]]]);
  });

  it("maps text equals to a case-insensitive exact match and contains to a wrapped pattern, both escaped", () => {
    expect(filtersFor([{ field: "company", operator: "equals", value: "Acme_Inc" }])).toEqual([["ilike", "company", "Acme\\_Inc"]]);
    expect(filtersFor([{ field: "title", operator: "contains", value: "50% off" }])).toEqual([["ilike", "title", "%50\\% off%"]]);
    expect(filtersFor([{ field: "city", operator: "equals", value: "Dubai" }])).toEqual([["ilike", "city", "Dubai"]]);
    expect(filtersFor([{ field: "country", operator: "contains", value: "Emirates" }])).toEqual([["ilike", "country", "%Emirates%"]]);
  });

  it("maps an email domain to a suffix match on email after the @", () => {
    expect(filtersFor([{ field: "email_domain", operator: "equals", value: "example.com" }])).toEqual([
      ["ilike", "email", "%@example.com"],
    ]);
  });

  it("maps dates to whole UTC days: before = strictly before that day, after = from the next day", () => {
    expect(filtersFor([{ field: "created_at", operator: "before", value: "2026-09-01" }])).toEqual([
      ["lt", "created_at", "2026-09-01T00:00:00.000Z"],
    ]);
    expect(filtersFor([{ field: "created_at", operator: "after", value: "2026-12-31" }])).toEqual([
      ["gte", "created_at", "2027-01-01T00:00:00.000Z"],
    ]);
  });

  it("ANDs rules by chaining every filter", () => {
    expect(
      filtersFor([
        { field: "status", operator: "is", value: "new" },
        { field: "email_domain", operator: "equals", value: "example.com" },
      ]),
    ).toEqual([
      ["eq", "status", "new"],
      ["ilike", "email", "%@example.com"],
    ]);
  });
});

describe("segment CRUD — always scoped to the owning user", () => {
  it("lists only the user's segments", async () => {
    const { client, calls } = createRecordingClient({ data: [] });
    await listLeadSegments(client, "user-1");
    expect(calls).toContainEqual(["from", "lead_segments"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
  });

  it("gets, updates and deletes by both user_id and id", async () => {
    const row = { id: "seg-1" };
    for (const run of [
      (client: Client) => getLeadSegment(client, "user-1", "seg-1"),
      (client: Client) => updateLeadSegment(client, "user-1", "seg-1", { name: "Renamed" }),
      (client: Client) => deleteLeadSegment(client, "user-1", "seg-1"),
    ]) {
      const { client, calls } = createRecordingClient({ data: row });
      await run(client);
      expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
      expect(calls).toContainEqual(["eq", "id", "seg-1"]);
    }
  });

  it("inserts with the given owner", async () => {
    const { client, calls } = createRecordingClient({ data: { id: "seg-1" } });
    await createLeadSegment(client, { user_id: "user-1", name: "Hot", rules: [] });
    expect(calls).toContainEqual(["insert", { user_id: "user-1", name: "Hot", rules: [] }]);
  });

  it("throws on a database error", async () => {
    const { client } = createRecordingClient({ error: new Error("rls denied") });
    await expect(deleteLeadSegment(client, "user-1", "seg-1")).rejects.toThrow("rls denied");
  });
});

describe("matching leads", () => {
  const rules: LeadSegmentRule[] = [{ field: "status", operator: "is", value: "new" }];

  it("counts matches for the user only, as a head count", async () => {
    const { client, calls } = createRecordingClient({ count: 7 });
    await expect(countLeadsMatchingRules(client, "user-1", rules)).resolves.toBe(7);
    expect(calls).toContainEqual(["select", "*", { count: "exact", head: true }]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "status", "new"]);
  });

  it("lists matches for the user with the caller's cap, newest first", async () => {
    const { client, calls } = createRecordingClient({ data: [{ id: "lead-1" }] });
    await expect(listLeadsMatchingRules(client, "user-1", rules, { limit: 10000 })).resolves.toEqual([{ id: "lead-1" }]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 10000]);
    expect(calls).toContainEqual(["eq", "status", "new"]);
  });

  it("throws on a database error", async () => {
    const { client } = createRecordingClient({ error: new Error("boom") });
    await expect(countLeadsMatchingRules(client, "user-1", rules)).rejects.toThrow("boom");
  });
});
