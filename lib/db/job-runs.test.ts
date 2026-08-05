import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { recordJobRun } from "./job-runs";

// Same fake-Client pattern as lib/db/integrations.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    insert: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  chainable.insert.mockReturnValue(chainable);

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
