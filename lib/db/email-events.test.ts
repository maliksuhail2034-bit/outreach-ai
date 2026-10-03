import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { getSentEventForOwner } from "./email-events";

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
