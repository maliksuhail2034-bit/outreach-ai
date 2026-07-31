import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { deleteSuppression, listSuppressions } from "./suppressions";

// Every lib/db/*.ts function takes a Client as its first argument instead of
// constructing one internally (see lib/db/shared.ts), so it can be tested
// against a lightweight fake instead of a live Supabase project. This
// builder mimics just enough of PostgREST's query-builder shape — every
// chain method (.select/.eq/.order/.delete/...) returns the same chainable
// object, and that object is thenable so `await` resolves to the given
// result no matter which method the chain ends on. Colocated here rather
// than extracted to a shared test-utils module since this is the only file
// using it so far — promote it once a second test file needs the same
// pattern.
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
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "delete", "insert", "update", "eq", "order", "in", "limit"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listSuppressions", () => {
  it("returns the rows on success", async () => {
    const rows = [{ id: "1", email: "bad@example.com" }];
    const { client } = createMockClient({ data: rows, error: null });

    const result = await listSuppressions(client, "user-1");

    expect(result).toBe(rows);
    expect(client.from).toHaveBeenCalledWith("suppressions");
  });

  it("scopes the query to the given user", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });
    await listSuppressions(client, "user-1");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("throws when the query errors, instead of returning a partial result", async () => {
    const { client } = createMockClient({ data: null, error: new Error("connection lost") });
    await expect(listSuppressions(client, "user-1")).rejects.toThrow("connection lost");
  });
});

describe("deleteSuppression", () => {
  it("resolves without throwing on success", async () => {
    const { client } = createMockClient({ error: null });
    await expect(deleteSuppression(client, "user-1", "suppression-1")).resolves.toBeUndefined();
  });

  it("scopes the delete to both the user and the row id", async () => {
    const { client, chainable } = createMockClient({ error: null });
    await deleteSuppression(client, "user-1", "suppression-1");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.eq).toHaveBeenCalledWith("id", "suppression-1");
  });

  it("throws when the delete errors", async () => {
    const { client } = createMockClient({ error: new Error("not found") });
    await expect(deleteSuppression(client, "user-1", "suppression-1")).rejects.toThrow("not found");
  });
});
