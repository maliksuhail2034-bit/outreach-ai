import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { countEmailsSentSince } from "./email-events";

function createClient(result: { count?: number | null; error?: unknown }) {
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "in", "eq", "gte"] as const) {
    chain[method].mockReturnValue(chain);
  }
  const from = vi.fn(() => chain);
  const client = { from } as unknown as Client;
  return { client, chain };
}

describe("countEmailsSentSince", () => {
  it("scopes to the given campaign ids, 'sent' events only, since the given instant", async () => {
    const { client, chain } = createClient({ count: 42, error: null });

    const result = await countEmailsSentSince(client, ["c-1", "c-2"], "2026-09-01T00:00:00.000Z");

    expect(client.from).toHaveBeenCalledWith("email_events");
    expect(chain.in).toHaveBeenCalledWith("campaign_id", ["c-1", "c-2"]);
    expect(chain.eq).toHaveBeenCalledWith("event_type", "sent");
    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-09-01T00:00:00.000Z");
    expect(result).toBe(42);
  });

  it("returns 0 rather than null when nothing was sent in the window", async () => {
    const { client } = createClient({ count: null, error: null });
    expect(await countEmailsSentSince(client, ["c-1"], "2026-09-01T00:00:00.000Z")).toBe(0);
  });

  it("returns 0 without querying when the account has no campaigns yet", async () => {
    const { client } = createClient({ count: 999, error: null }); // would return 999 if queried — must not be
    expect(await countEmailsSentSince(client, [], "2026-09-01T00:00:00.000Z")).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });
});
