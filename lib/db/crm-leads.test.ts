import { describe, expect, it } from "vitest";
import type { Client } from "./shared";
import { listCrmLeadsPage } from "./crm-leads";

type Call = [string, ...unknown[]];

// A fake PostgREST builder: records every chained call, and resolves each
// query (await) with the next queued result.
function fakeClient(results: { data?: unknown[]; count?: number; error?: { code: string } | null }[]) {
  const queries: Call[][] = [];
  const client = {
    rpc(...args: unknown[]) {
      const calls: Call[] = [["rpc", ...args]];
      queries.push(calls);
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === "then") {
              const result = results.shift() ?? { data: [], count: 0, error: null };
              return (resolve: (value: unknown) => void) => resolve({ data: null, count: null, error: null, ...result });
            }
            return (...callArgs: unknown[]) => {
              calls.push([prop, ...callArgs]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  return { client: client as unknown as Client, queries };
}

describe("listCrmLeadsPage", () => {
  it("calls crm_leads with the engagement filter and pages with a unique tiebreaker", async () => {
    const { client, queries } = fakeClient([{ data: [{ id: "a" }], count: 120 }]);

    const result = await listCrmLeadsPage(
      client,
      "user-1",
      { engagement: "not_opened", campaignId: "c-1", stepId: "s-1", sort: "opens", status: "won", listId: "none" },
      3,
    );

    expect(result).toEqual({ leads: [{ id: "a" }], page: 3, pageSize: 50, totalCount: 120 });
    const calls = queries[0];
    expect(calls[0]).toEqual(["rpc", "crm_leads", { p_engagement: "not_opened", p_campaign_id: "c-1", p_step_id: "s-1" }, { count: "exact", head: false, get: true }]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "status", "won"]);
    expect(calls).toContainEqual(["is", "list_id", null]);
    const orders = calls.filter(([name]) => name === "order").map(([, column]) => column);
    expect(orders).toEqual(["crm_opens", "created_at", "id"]);
    expect(calls).toContainEqual(["range", 100, 149]);
  });

  it("turns each search word into an OR over name, email and company, with filter syntax stripped", async () => {
    const { client, queries } = fakeClient([{ data: [], count: 0 }]);

    await listCrmLeadsPage(client, "user-1", { search: 'jane,(id.eq.x) 50%_off "acme"' }, 1);

    const ors = queries[0].filter(([name]) => name === "or").map(([, filter]) => filter as string);
    expect(ors).toHaveLength(4);
    for (const filter of ors) {
      expect(filter).not.toMatch(/[()"]/);
      expect(filter.split(",")).toHaveLength(5);
    }
    expect(ors[0]).toBe(
      "email.ilike.%jane%,display_email.ilike.%jane%,first_name.ilike.%jane%,last_name.ilike.%jane%,company.ilike.%jane%",
    );
    // % and _ are matched literally.
    expect(ors[2]).toContain("email.ilike.%50\\%\\_off%");
  });

  it("falls back to the last page when the requested page is past the end", async () => {
    const { client, queries } = fakeClient([
      { data: null as never, error: { code: "PGRST103" } },
      { count: 75 },
      { data: [{ id: "z" }], count: 75 },
    ]);

    const result = await listCrmLeadsPage(client, "user-1", {}, 9);

    expect(result).toMatchObject({ page: 2, totalCount: 75, leads: [{ id: "z" }] });
    expect(queries[1][0][3]).toMatchObject({ head: true });
    expect(queries[2]).toContainEqual(["range", 50, 99]);
  });

  it("throws any other error", async () => {
    const { client } = fakeClient([{ error: { code: "42501" } }]);
    await expect(listCrmLeadsPage(client, "user-1", {}, 1)).rejects.toEqual({ code: "42501" });
  });
});
