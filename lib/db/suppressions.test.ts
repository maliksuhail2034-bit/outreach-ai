import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { createSuppression, deleteSuppression, getSuppressedEmails, getSuppression, listSuppressions } from "./suppressions";

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
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of [
    "select",
    "delete",
    "insert",
    "update",
    "eq",
    "order",
    "in",
    "limit",
    "single",
    "maybeSingle",
  ] as const) {
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

describe("getSuppression", () => {
  it("returns the row when the address is suppressed", async () => {
    const row = { id: "1", email: "bad@example.com", reason: "bounced" };
    const { client, chainable } = createMockClient({ data: row, error: null });

    const result = await getSuppression(client, "user-1", "bad@example.com");

    expect(result).toBe(row);
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.eq).toHaveBeenCalledWith("email", "bad@example.com");
  });

  it("returns null when the address isn't suppressed, instead of throwing", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await getSuppression(client, "user-1", "good@example.com")).toBeNull();
  });

  it("throws when the query errors", async () => {
    const { client } = createMockClient({ data: null, error: new Error("connection lost") });
    await expect(getSuppression(client, "user-1", "x@example.com")).rejects.toThrow("connection lost");
  });
});

describe("createSuppression", () => {
  it("inserts the given values", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await createSuppression(client, {
      user_id: "user-1",
      email: "bad@example.com",
      reason: "unsubscribed",
      source_campaign_id: "campaign-1",
    });

    expect(chainable.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", email: "bad@example.com", reason: "unsubscribed" }),
    );
  });

  it("swallows a duplicate (already-suppressed) insert instead of throwing", async () => {
    const { client } = createMockClient({ error: { code: "23505", message: "duplicate key" } });
    await expect(
      createSuppression(client, { user_id: "user-1", email: "bad@example.com", reason: "unsubscribed" }),
    ).resolves.toBeUndefined();
  });

  it("throws on any other error", async () => {
    const { client } = createMockClient({ error: { code: "23503", message: "foreign key violation" } });
    await expect(
      createSuppression(client, { user_id: "user-1", email: "bad@example.com", reason: "unsubscribed" }),
    ).rejects.toMatchObject({ code: "23503" });
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

describe("getSuppressedEmails", () => {
  it("returns a Map of only the emails that are actually suppressed", async () => {
    const rows = [
      { email: "bounced@example.com", reason: "bounced" },
      { email: "unsub@example.com", reason: "unsubscribed" },
    ];
    const { client } = createMockClient({ data: rows, error: null });

    const result = await getSuppressedEmails(client, "user-1", [
      "bounced@example.com",
      "unsub@example.com",
      "clean@example.com",
    ]);

    expect(result.get("bounced@example.com")).toBe("bounced");
    expect(result.get("unsub@example.com")).toBe("unsubscribed");
    expect(result.has("clean@example.com")).toBe(false);
  });

  it("returns an empty Map without querying when given no emails", async () => {
    const { client } = createMockClient({ data: null, error: null });

    const result = await getSuppressedEmails(client, "user-1", []);

    expect(result.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws when the query errors", async () => {
    const { client } = createMockClient({ data: null, error: new Error("connection lost") });
    await expect(getSuppressedEmails(client, "user-1", ["a@example.com"])).rejects.toThrow("connection lost");
  });

  // The crux of "suppression must survive lead deletion / block
  // re-enrollment": suppressions are keyed by (user_id, email), not lead_id
  // (see supabase/migrations/20260730100010_suppressions.sql) — there is no
  // foreign key from suppressions back to leads, so a lead being deleted (or
  // re-created via a fresh CSV import with the same address) never removes
  // its suppression row. getSuppressedEmails looks up purely by email, so it
  // still flags the address as suppressed for a brand-new lead row with no
  // relation at all to whichever lead originally triggered the suppression.
  it("still flags an address as suppressed for a lead row that didn't exist when the suppression was created", async () => {
    const rows = [{ email: "returning@example.com", reason: "unsubscribed" }];
    const { client } = createMockClient({ data: rows, error: null });

    // Simulates a re-imported lead: a brand-new lead id, same email as a
    // previously deleted+suppressed lead.
    const result = await getSuppressedEmails(client, "user-1", ["returning@example.com"]);

    expect(result.get("returning@example.com")).toBe("unsubscribed");
  });
});
