import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import {
  claimDueWarmupSends,
  countWarmupMessagesReceivedOnDate,
  getWarmupProfileByMailbox,
  getWarmupProfileByMailboxId,
  insertWarmupEvent,
  listWarmupMessagesSentOnDate,
  listWarmupProfiles,
  updateWarmupProfile,
  upsertWarmupStat,
} from "./warmup";

// Same fake-Client pattern as lib/db/deliverability.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "update", "upsert", "eq", "gte", "lte", "order", "single", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listWarmupProfiles", () => {
  it("scopes peer candidates to a single organization", async () => {
    const { client, chainable } = createMockClient({ data: [{ id: "profile-1" }], error: null });

    await listWarmupProfiles(client, "org-a");

    expect(client.from).toHaveBeenCalledWith("warmup_profiles");
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(chainable.eq).not.toHaveBeenCalledWith("organization_id", "org-b");
  });
});

// Batch 5: proves claim_due_warmup_sends is called with no organization
// filter, i.e. the fix for the hardcoded WARMUP_ENGINE_ORGANIZATION_ID
// single-org restriction (lib/warmup/warmup-worker.ts previously passed it
// through here as p_organization_id). No local Postgres/Supabase instance
// was available in this environment to exercise the SQL function itself
// (Docker was not running); this is the strongest repository-level proof
// available that the TypeScript-level restriction is gone — the SQL
// function's own behavior (that it now returns rows across all
// organizations) still needs to be confirmed once this migration is
// applied to a real database.
describe("claimDueWarmupSends", () => {
  it("calls claim_due_warmup_sends with only p_limit, no organization filter", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "profile-1" }, { id: "profile-2" }], error: null });
    const client = { rpc } as unknown as Client;

    const result = await claimDueWarmupSends(client, 5);

    expect(rpc).toHaveBeenCalledWith("claim_due_warmup_sends", { p_limit: 5 });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_organization_id");
    expect(result).toEqual([{ id: "profile-1" }, { id: "profile-2" }]);
  });

  it("defaults the limit to 10 when not given", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = { rpc } as unknown as Client;

    await claimDueWarmupSends(client);

    expect(rpc).toHaveBeenCalledWith("claim_due_warmup_sends", { p_limit: 10 });
  });
});

describe("getWarmupProfileByMailbox", () => {
  it("scopes the lookup to both organization and mailbox", async () => {
    const { client, chainable } = createMockClient({ data: null, error: null });

    await getWarmupProfileByMailbox(client, "org-1", "mailbox-1");

    expect(client.from).toHaveBeenCalledWith("warmup_profiles");
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("mailbox_id", "mailbox-1");
  });
});

describe("getWarmupProfileByMailboxId", () => {
  it("scopes the lookup to mailbox_id only, with no organization filter", async () => {
    const { client, chainable } = createMockClient({ data: null, error: null });

    await getWarmupProfileByMailboxId(client, "mailbox-1");

    expect(client.from).toHaveBeenCalledWith("warmup_profiles");
    expect(chainable.eq).toHaveBeenCalledWith("mailbox_id", "mailbox-1");
    expect(chainable.eq).not.toHaveBeenCalledWith("organization_id", expect.anything());
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

describe("listWarmupMessagesSentOnDate", () => {
  it("scopes to the sending profile and the given day's bounds", async () => {
    const { client, chainable } = createMockClient({ data: [{ message_type: "initial", reply_decision: "replied" }], error: null });

    const result = await listWarmupMessagesSentOnDate(client, "profile-1", "2026-08-26T00:00:00.000Z", "2026-08-26T23:59:59.999Z");

    expect(client.from).toHaveBeenCalledWith("warmup_messages");
    expect(chainable.eq).toHaveBeenCalledWith("from_warmup_profile_id", "profile-1");
    expect(chainable.gte).toHaveBeenCalledWith("sent_at", "2026-08-26T00:00:00.000Z");
    expect(chainable.lte).toHaveBeenCalledWith("sent_at", "2026-08-26T23:59:59.999Z");
    expect(result).toEqual([{ message_type: "initial", reply_decision: "replied" }]);
  });
});

describe("countWarmupMessagesReceivedOnDate", () => {
  it("scopes to the recipient mailbox and the given day's bounds", async () => {
    const { client, chainable } = createMockClient({ count: 3, error: null });

    const result = await countWarmupMessagesReceivedOnDate(client, "mailbox-1", "2026-08-26T00:00:00.000Z", "2026-08-26T23:59:59.999Z");

    expect(client.from).toHaveBeenCalledWith("warmup_messages");
    expect(chainable.eq).toHaveBeenCalledWith("to_mailbox_id", "mailbox-1");
    expect(chainable.gte).toHaveBeenCalledWith("sent_at", "2026-08-26T00:00:00.000Z");
    expect(chainable.lte).toHaveBeenCalledWith("sent_at", "2026-08-26T23:59:59.999Z");
    expect(result).toBe(3);
  });

  it("returns 0 rather than null when nothing arrived that day", async () => {
    const { client } = createMockClient({ count: null, error: null });
    const result = await countWarmupMessagesReceivedOnDate(client, "mailbox-1", "2026-08-26T00:00:00.000Z", "2026-08-26T23:59:59.999Z");
    expect(result).toBe(0);
  });
});

describe("upsertWarmupStat", () => {
  it("upserts on the (warmup_profile_id, stat_date) unique key so a re-run replaces the prior row", async () => {
    const { client, chainable } = createMockClient({ data: { id: "stat-1" }, error: null });

    await upsertWarmupStat(client, {
      warmup_profile_id: "profile-1",
      organization_id: "org-1",
      stat_date: "2026-08-26",
      emails_sent: 4,
      emails_received: 2,
      reply_rate: 50,
      positive_interactions: 1,
      warmup_score: 62,
    });

    expect(chainable.upsert).toHaveBeenCalledWith(
      {
        warmup_profile_id: "profile-1",
        organization_id: "org-1",
        stat_date: "2026-08-26",
        emails_sent: 4,
        emails_received: 2,
        reply_rate: 50,
        positive_interactions: 1,
        warmup_score: 62,
      },
      { onConflict: "warmup_profile_id,stat_date" },
    );
  });
});
