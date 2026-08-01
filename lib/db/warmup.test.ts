import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { getWarmupProfileByMailbox, insertWarmupEvent, updateWarmupProfile } from "./warmup";

// Same fake-Client pattern as lib/db/deliverability.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "update", "eq", "order", "single", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("getWarmupProfileByMailbox", () => {
  it("scopes the lookup to both organization and mailbox", async () => {
    const { client, chainable } = createMockClient({ data: null, error: null });

    await getWarmupProfileByMailbox(client, "org-1", "mailbox-1");

    expect(client.from).toHaveBeenCalledWith("warmup_profiles");
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("mailbox_id", "mailbox-1");
  });
});

describe("updateWarmupProfile", () => {
  it("scopes the update to both organization and mailbox", async () => {
    const { client, chainable } = createMockClient({ data: { id: "profile-1" }, error: null });

    await updateWarmupProfile(client, "org-1", "mailbox-1", { status: "paused" });

    expect(chainable.update).toHaveBeenCalledWith({ status: "paused" });
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("mailbox_id", "mailbox-1");
  });
});

describe("insertWarmupEvent", () => {
  it("inserts the given values and returns the created row", async () => {
    const { client, chainable } = createMockClient({ data: { id: "event-1" }, error: null });

    const result = await insertWarmupEvent(client, {
      warmup_profile_id: "profile-1",
      organization_id: "org-1",
      event_type: "status_changed",
    });

    expect(chainable.insert).toHaveBeenCalledWith({
      warmup_profile_id: "profile-1",
      organization_id: "org-1",
      event_type: "status_changed",
    });
    expect(result).toEqual({ id: "event-1" });
  });
});
