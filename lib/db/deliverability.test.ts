import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import {
  getMailboxHealthByMailboxId,
  insertDomainDnsCheck,
  listDomainDnsChecks,
  upsertMailboxHealth,
} from "./deliverability";

// Same fake-Client pattern as lib/db/leads.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "upsert", "eq", "order", "single", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listDomainDnsChecks", () => {
  it("scopes to the owning user and orders newest-first", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listDomainDnsChecks(client, "user-1");

    expect(client.from).toHaveBeenCalledWith("domain_dns_checks");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(chainable.order).toHaveBeenCalledWith("checked_at", { ascending: false });
  });

  it("returns an empty array instead of null when there are no rows", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await listDomainDnsChecks(client, "user-1")).toEqual([]);
  });
});

describe("insertDomainDnsCheck", () => {
  it("inserts the given values and returns the created row", async () => {
    const { client, chainable } = createMockClient({ data: { id: "check-1" }, error: null });

    const result = await insertDomainDnsCheck(client, {
      domain_id: "domain-1",
      user_id: "user-1",
      record_type: "spf",
      status: "pending",
    });

    expect(chainable.insert).toHaveBeenCalledWith({
      domain_id: "domain-1",
      user_id: "user-1",
      record_type: "spf",
      status: "pending",
    });
    expect(result).toEqual({ id: "check-1" });
  });
});

describe("getMailboxHealthByMailboxId", () => {
  it("scopes the lookup to mailbox_id only, with no user filter", async () => {
    const { client, chainable } = createMockClient({ data: null, error: null });

    await getMailboxHealthByMailboxId(client, "mailbox-1");

    expect(client.from).toHaveBeenCalledWith("mailbox_health");
    expect(chainable.eq).toHaveBeenCalledWith("mailbox_id", "mailbox-1");
    expect(chainable.eq).not.toHaveBeenCalledWith("user_id", expect.anything());
  });
});

describe("upsertMailboxHealth", () => {
  it("upserts on mailbox_id so recalculation replaces the prior row", async () => {
    const { client, chainable } = createMockClient({ data: { id: "health-1" }, error: null });

    await upsertMailboxHealth(client, {
      mailbox_id: "mailbox-1",
      user_id: "user-1",
      warmup_status: "warming",
      health_score: 50,
    });

    expect(chainable.upsert).toHaveBeenCalledWith(
      { mailbox_id: "mailbox-1", user_id: "user-1", warmup_status: "warming", health_score: 50 },
      { onConflict: "mailbox_id" },
    );
  });
});
