import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";

const { upsertDailyRollupMock, listMailboxDomainsByIdsMock, captureErrorMock } = vi.hoisted(() => ({
  upsertDailyRollupMock: vi.fn(),
  listMailboxDomainsByIdsMock: vi.fn(),
  captureErrorMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  upsertDailyRollup: upsertDailyRollupMock,
  listMailboxDomainsByIds: listMailboxDomainsByIdsMock,
}));

vi.mock("@/lib/monitoring/error-tracking", () => ({
  captureError: captureErrorMock,
}));

import { runAnalyticsRollupWorker } from "./rollup-worker";

function createSupabaseStub(rpcResult: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { rpc } as unknown as Client;
}

const CAMPAIGN_ROW = {
  organization_id: "org-1",
  rollup_date: "2026-08-15",
  event_type: "sent",
  subject_type: "campaign",
  subject_id: "campaign-1",
  event_count: 10,
};

const MAILBOX_ROW_A = {
  organization_id: "org-1",
  rollup_date: "2026-08-15",
  event_type: "sent",
  subject_type: "mailbox",
  subject_id: "mailbox-1",
  event_count: 6,
};

const MAILBOX_ROW_B = {
  organization_id: "org-1",
  rollup_date: "2026-08-15",
  event_type: "sent",
  subject_type: "mailbox",
  subject_id: "mailbox-2",
  event_count: 4,
};

const ORG_ROW = {
  organization_id: "org-1",
  rollup_date: "2026-08-15",
  event_type: "sent",
  subject_type: "organization",
  subject_id: "org-1",
  event_count: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertDailyRollupMock.mockResolvedValue({});
  listMailboxDomainsByIdsMock.mockResolvedValue([]);
});

describe("runAnalyticsRollupWorker", () => {
  it("upserts one rollup row per row the RPC returns", async () => {
    const supabase = createSupabaseStub({ data: [CAMPAIGN_ROW, ORG_ROW], error: null });

    const summary = await runAnalyticsRollupWorker(supabase, { since: "2026-08-15", until: "2026-08-15" });

    expect(summary).toEqual({ since: "2026-08-15", until: "2026-08-15", rowsComputed: 2, rowsUpserted: 2, failed: 0 });
    expect(upsertDailyRollupMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ subject_type: "campaign", subject_id: "campaign-1", event_count: 10 }),
    );
    expect(upsertDailyRollupMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ subject_type: "organization", subject_id: "org-1", event_count: 10 }),
    );
  });

  it("calls compute_email_event_rollups with the given date range", async () => {
    const supabase = createSupabaseStub({ data: [], error: null });

    await runAnalyticsRollupWorker(supabase, { since: "2026-01-01", until: "2026-01-31" });

    expect(supabase.rpc).toHaveBeenCalledWith("compute_email_event_rollups", {
      p_since: "2026-01-01",
      p_until: "2026-01-31",
    });
  });

  it("defaults to yesterday (UTC) when no range is given", async () => {
    const supabase = createSupabaseStub({ data: [], error: null });

    const expectedYesterday = new Date();
    expectedYesterday.setUTCDate(expectedYesterday.getUTCDate() - 1);
    const expectedIso = expectedYesterday.toISOString().slice(0, 10);

    const summary = await runAnalyticsRollupWorker(supabase);

    expect(summary.since).toBe(expectedIso);
    expect(summary.until).toBe(expectedIso);
    expect(supabase.rpc).toHaveBeenCalledWith("compute_email_event_rollups", {
      p_since: expectedIso,
      p_until: expectedIso,
    });
  });

  it("isolates a single upsert failure so the rest of the run still completes", async () => {
    const supabase = createSupabaseStub({ data: [CAMPAIGN_ROW, ORG_ROW], error: null });
    upsertDailyRollupMock.mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValueOnce({});

    const summary = await runAnalyticsRollupWorker(supabase, { since: "2026-08-15", until: "2026-08-15" });

    expect(summary).toEqual({ since: "2026-08-15", until: "2026-08-15", rowsComputed: 2, rowsUpserted: 1, failed: 1 });
    expect(captureErrorMock).toHaveBeenCalledWith(expect.objectContaining({ job: "analytics-rollup" }));
  });

  it("throws when the RPC itself errors", async () => {
    const supabase = createSupabaseStub({ data: null, error: { message: "function does not exist" } });

    await expect(runAnalyticsRollupWorker(supabase, { since: "2026-08-15", until: "2026-08-15" })).rejects.toBeTruthy();
    expect(upsertDailyRollupMock).not.toHaveBeenCalled();
  });

  it("sums mailbox-level rows into a domain-level rollup, grouped by domain_id", async () => {
    const supabase = createSupabaseStub({ data: [MAILBOX_ROW_A, MAILBOX_ROW_B], error: null });
    listMailboxDomainsByIdsMock.mockResolvedValue([
      { id: "mailbox-1", domain_id: "domain-1" },
      { id: "mailbox-2", domain_id: "domain-1" },
    ]);

    const summary = await runAnalyticsRollupWorker(supabase, { since: "2026-08-15", until: "2026-08-15" });

    // 2 mailbox rows + 1 summed domain row.
    expect(summary).toEqual({ since: "2026-08-15", until: "2026-08-15", rowsComputed: 2, rowsUpserted: 3, failed: 0 });
    expect(upsertDailyRollupMock).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ subject_type: "domain", subject_id: "domain-1", event_count: 10 }),
    );
  });

  it("skips a mailbox row whose mailbox has no linked domain", async () => {
    const supabase = createSupabaseStub({ data: [MAILBOX_ROW_A], error: null });
    listMailboxDomainsByIdsMock.mockResolvedValue([{ id: "mailbox-1", domain_id: null }]);

    const summary = await runAnalyticsRollupWorker(supabase, { since: "2026-08-15", until: "2026-08-15" });

    expect(summary).toEqual({ since: "2026-08-15", until: "2026-08-15", rowsComputed: 1, rowsUpserted: 1, failed: 0 });
    expect(upsertDailyRollupMock).not.toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ subject_type: "domain" }),
    );
  });

  it("does not attempt a domain rollup when no mailbox-level rows exist", async () => {
    const supabase = createSupabaseStub({ data: [CAMPAIGN_ROW], error: null });

    await runAnalyticsRollupWorker(supabase, { since: "2026-08-15", until: "2026-08-15" });

    expect(listMailboxDomainsByIdsMock).not.toHaveBeenCalled();
  });
});
