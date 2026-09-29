import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { countEmailsSentSince, getSentEventForOwner } from "./email-events";

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

// M4: the reply-matching lookup must only ever return a 'sent' event whose
// campaign belongs to the mailbox owner — the filter runs in the database
// (an inner join on campaigns), since the reply worker uses the admin client.
describe("getSentEventForOwner", () => {
  function createSingleClient(result: { data: unknown; error: unknown }) {
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => result) };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    const client = { from: vi.fn(() => chain) } as unknown as Client;
    return { client, chain };
  }

  it("inner-joins campaigns and filters by the owner, the Message-ID and 'sent'", async () => {
    const event = { id: "sent-event-1", campaign_id: "campaign-1", campaigns: { user_id: "user-1" } };
    const { client, chain } = createSingleClient({ data: event, error: null });

    const result = await getSentEventForOwner(client, "sent-1@example.com", "user-1");

    expect(client.from).toHaveBeenCalledWith("email_events");
    expect(chain.select).toHaveBeenCalledWith("*, campaigns!inner(user_id)");
    expect(chain.eq).toHaveBeenCalledWith("provider_message_id", "sent-1@example.com");
    expect(chain.eq).toHaveBeenCalledWith("event_type", "sent");
    expect(chain.eq).toHaveBeenCalledWith("campaigns.user_id", "user-1");
    expect(result).toEqual(event);
  });

  it("returns null when no event matches for this owner", async () => {
    const { client } = createSingleClient({ data: null, error: null });
    expect(await getSentEventForOwner(client, "sent-1@example.com", "user-2")).toBeNull();
  });

  it("throws a database error rather than treating it as no match", async () => {
    const failure = { message: "timeout", code: "57014" };
    const { client } = createSingleClient({ data: null, error: failure });
    await expect(getSentEventForOwner(client, "sent-1@example.com", "user-1")).rejects.toBe(failure);
  });
});
