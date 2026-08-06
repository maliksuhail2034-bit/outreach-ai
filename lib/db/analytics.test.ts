import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { insertAnalyticsEvent, listAnalyticsEvents, listDailyRollups, upsertDailyRollup } from "./analytics";

// Same fake-Client pattern as lib/db/warmup.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "upsert", "eq", "gte", "lte", "in", "order", "limit", "single"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listAnalyticsEvents", () => {
  it("scopes to the organization and orders newest-first", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listAnalyticsEvents(client, "org-1");

    expect(client.from).toHaveBeenCalledWith("analytics_events");
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.order).toHaveBeenCalledWith("occurred_at", { ascending: false });
  });

  it("applies optional filters when provided", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listAnalyticsEvents(client, "org-1", {
      eventType: "opened",
      subjectType: "campaign",
      subjectId: "campaign-1",
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-31T00:00:00.000Z",
    });

    expect(chainable.eq).toHaveBeenCalledWith("event_type", "opened");
    expect(chainable.eq).toHaveBeenCalledWith("subject_type", "campaign");
    expect(chainable.eq).toHaveBeenCalledWith("subject_id", "campaign-1");
    expect(chainable.gte).toHaveBeenCalledWith("occurred_at", "2026-08-01T00:00:00.000Z");
    expect(chainable.lte).toHaveBeenCalledWith("occurred_at", "2026-08-31T00:00:00.000Z");
  });

  it("returns an empty array instead of null when there are no rows", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await listAnalyticsEvents(client, "org-1")).toEqual([]);
  });
});

describe("listDailyRollups", () => {
  it("scopes to the organization and orders oldest-first", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listDailyRollups(client, "org-1");

    expect(client.from).toHaveBeenCalledWith("analytics_daily_rollups");
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.order).toHaveBeenCalledWith("rollup_date", { ascending: true });
  });

  it("applies subjectType/subjectId filters when provided (Scalability Track, Phase D)", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listDailyRollups(client, "org-1", { subjectType: "mailbox", subjectId: "mailbox-1" });

    expect(chainable.eq).toHaveBeenCalledWith("subject_type", "mailbox");
    expect(chainable.eq).toHaveBeenCalledWith("subject_id", "mailbox-1");
  });

  it("applies a subjectIds filter for aggregating across multiple subjects (e.g. a domain's mailboxes)", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listDailyRollups(client, "org-1", { subjectType: "mailbox", subjectIds: ["mailbox-1", "mailbox-2"] });

    expect(chainable.in).toHaveBeenCalledWith("subject_id", ["mailbox-1", "mailbox-2"]);
  });

  it("applies the existing date-range and eventType filters when provided", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listDailyRollups(client, "org-1", {
      since: "2026-08-01",
      until: "2026-08-31",
      eventType: "sent",
    });

    expect(chainable.gte).toHaveBeenCalledWith("rollup_date", "2026-08-01");
    expect(chainable.lte).toHaveBeenCalledWith("rollup_date", "2026-08-31");
    expect(chainable.eq).toHaveBeenCalledWith("event_type", "sent");
  });

  it("returns an empty array instead of null when there are no rows", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await listDailyRollups(client, "org-1")).toEqual([]);
  });
});

describe("insertAnalyticsEvent", () => {
  it("inserts the given values and returns the created row", async () => {
    const { client, chainable } = createMockClient({ data: { id: "event-1" }, error: null });

    const result = await insertAnalyticsEvent(client, {
      organization_id: "org-1",
      event_type: "opened",
    });

    expect(chainable.insert).toHaveBeenCalledWith({ organization_id: "org-1", event_type: "opened" });
    expect(result).toEqual({ id: "event-1" });
  });
});

describe("upsertDailyRollup", () => {
  it("upserts on the full unique key so a re-run replaces the prior count", async () => {
    const { client, chainable } = createMockClient({ data: { id: "rollup-1" }, error: null });

    await upsertDailyRollup(client, {
      organization_id: "org-1",
      rollup_date: "2026-08-01",
      event_type: "opened",
      subject_type: "organization",
      subject_id: "org-1",
      event_count: 5,
    });

    expect(chainable.upsert).toHaveBeenCalledWith(
      {
        organization_id: "org-1",
        rollup_date: "2026-08-01",
        event_type: "opened",
        subject_type: "organization",
        subject_id: "org-1",
        event_count: 5,
      },
      { onConflict: "organization_id,rollup_date,event_type,subject_type,subject_id" },
    );
  });
});
