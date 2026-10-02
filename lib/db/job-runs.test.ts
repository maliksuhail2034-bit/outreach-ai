import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { getLatestJobRunSummary, recordJobRun } from "./job-runs";

// Same fake-Client pattern as lib/db/integrations.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    insert: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  chainable.insert.mockReturnValue(chainable);
  chainable.select.mockReturnValue(chainable);
  chainable.eq.mockReturnValue(chainable);
  chainable.order.mockReturnValue(chainable);
  chainable.limit.mockReturnValue(chainable);
  chainable.maybeSingle.mockReturnValue(chainable);

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("recordJobRun", () => {
  it("inserts the given row into job_runs", async () => {
    const { client, chainable } = createMockClient({ error: null });
    const values = {
      job: "send-emails" as const,
      status: "success" as const,
      summary: { claimed: 1, sent: 1, failed: 0, needsReview: 0, skipped: 0 },
      error: null,
      duration_ms: 120,
      started_at: "2026-08-11T00:00:00.000Z",
    };

    await recordJobRun(client, values);

    expect(client.from).toHaveBeenCalledWith("job_runs");
    expect(chainable.insert).toHaveBeenCalledWith(values);
  });

  it("throws when the insert fails", async () => {
    const { client } = createMockClient({ error: new Error("insert failed") });

    await expect(
      recordJobRun(client, {
        job: "send-emails",
        status: "error",
        summary: {},
        error: "boom",
        duration_ms: 5,
        started_at: "2026-08-11T00:00:00.000Z",
      }),
    ).rejects.toThrow("insert failed");
  });
});

describe("getLatestJobRunSummary", () => {
  it("reads the most recent run's summary for the given job", async () => {
    const summary = { mailboxesFailed: 1, failedMailboxIds: ["mb-1"] };
    const { client, chainable } = createMockClient({ data: { summary }, error: null });

    await expect(getLatestJobRunSummary(client, "sync-replies")).resolves.toEqual(summary);

    expect(client.from).toHaveBeenCalledWith("job_runs");
    expect(chainable.select).toHaveBeenCalledWith("summary");
    expect(chainable.eq).toHaveBeenCalledWith("job", "sync-replies");
    expect(chainable.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chainable.limit).toHaveBeenCalledWith(1);
  });

  it("returns null when the job has never run", async () => {
    const { client } = createMockClient({ data: null, error: null });

    await expect(getLatestJobRunSummary(client, "sync-replies")).resolves.toBeNull();
  });

  it("throws when the read fails", async () => {
    const { client } = createMockClient({ error: new Error("read failed") });

    await expect(getLatestJobRunSummary(client, "sync-replies")).rejects.toThrow("read failed");
  });
});
