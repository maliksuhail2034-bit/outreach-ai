import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { listActiveMailboxesForHealthCheck, markMailboxErrored } from "./mailboxes";

// Same fake-Client pattern as lib/db/deliverability.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "eq", "limit"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listActiveMailboxesForHealthCheck", () => {
  it("scopes to active mailboxes across every user", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listActiveMailboxesForHealthCheck(client);

    expect(client.from).toHaveBeenCalledWith("mailboxes");
    expect(chainable.eq).toHaveBeenCalledWith("status", "active");
  });

  it("strips encrypted credentials from every returned row", async () => {
    const { client } = createMockClient({
      data: [
        {
          id: "mailbox-1",
          user_id: "user-1",
          status: "active",
          encrypted_smtp_password: "secret-smtp",
          encrypted_imap_password: "secret-imap",
        },
      ],
      error: null,
    });

    const result = await listActiveMailboxesForHealthCheck(client);

    expect(result).toEqual([{ id: "mailbox-1", user_id: "user-1", status: "active" }]);
  });

  it("returns an empty array instead of null when there are no rows", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await listActiveMailboxesForHealthCheck(client)).toEqual([]);
  });
});

// A one-row fake of the mailboxes table that really applies update().eq()
// filters, so the status guard is exercised rather than assumed.
function createMailboxTable(row: { id: string; status: string }) {
  const table = { row: { ...row } };
  const client = {
    from: vi.fn(() => ({
      update: (values: { status: string }) => {
        const filters: [string, string][] = [];
        const query = {
          eq(column: string, value: string) {
            filters.push([column, value]);
            return query;
          },
          async select() {
            const current = table.row as Record<string, string>;
            const matches = filters.every(([column, value]) => current[column] === value);
            if (matches) table.row = { ...table.row, ...values };
            return { data: matches ? [{ id: table.row.id }] : [], error: null };
          },
        };
        return query;
      },
    })),
  } as unknown as Client;
  return { client, table };
}

describe("markMailboxErrored", () => {
  it("moves an active mailbox to error and reports the transition", async () => {
    const { client, table } = createMailboxTable({ id: "mailbox-1", status: "active" });

    expect(await markMailboxErrored(client, "mailbox-1")).toBe(true);
    expect(table.row.status).toBe("error");
  });

  it.each(["paused", "error", "disconnected"])("leaves a %s mailbox untouched and reports no transition", async (status) => {
    const { client, table } = createMailboxTable({ id: "mailbox-1", status });

    expect(await markMailboxErrored(client, "mailbox-1")).toBe(false);
    expect(table.row.status).toBe(status);
  });

  it("only targets the given mailbox", async () => {
    const { client, table } = createMailboxTable({ id: "mailbox-2", status: "active" });

    expect(await markMailboxErrored(client, "mailbox-1")).toBe(false);
    expect(table.row.status).toBe("active");
  });

  it("throws when the update fails", async () => {
    const failure = new Error("permission denied");
    const chain = { eq: () => chain, select: async () => ({ data: null, error: failure }) };
    const client = { from: () => ({ update: () => chain }) } as unknown as Client;

    await expect(markMailboxErrored(client, "mailbox-1")).rejects.toBe(failure);
  });
});
