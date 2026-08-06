import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { listActiveMailboxesForHealthCheck } from "./mailboxes";

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
