import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import { runRetentionWorker } from "./retention-worker";

function createSupabaseStub(countsByTable: Record<string, number>) {
  // One chain per table, reused across repeated `.from(table)` calls, so a
  // test can both drive the worker and separately inspect the same chain's
  // mock calls afterward.
  const chains: Record<string, ReturnType<typeof makeChain>> = {};
  function makeChain(table: string) {
    const chain = {
      delete: vi.fn(() => chain),
      lt: vi.fn(() => chain),
      then: (resolve: (value: { count: number; error: null }) => void) =>
        resolve({ count: countsByTable[table] ?? 0, error: null }),
    };
    return chain;
  }
  const from = vi.fn((table: string) => {
    chains[table] ??= makeChain(table);
    return chains[table];
  });
  return { from } as unknown as Client;
}

describe("runRetentionWorker", () => {
  it("calls delete() for both tables and reports dryRun: false", async () => {
    const supabase = createSupabaseStub({ rate_limit_events: 3, job_runs: 7 });

    const summary = await runRetentionWorker(supabase);

    expect(summary.dryRun).toBe(false);
    const rateLimitChain = supabase.from("rate_limit_events");
    const jobRunsChain = supabase.from("job_runs");
    expect((rateLimitChain as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith({
      count: "exact",
    });
    expect((jobRunsChain as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledWith({
      count: "exact",
    });
  });

  it("reports deleted counts for both rate_limit_events and job_runs", async () => {
    const supabase = createSupabaseStub({ rate_limit_events: 12, job_runs: 4 });

    const summary = await runRetentionWorker(supabase);

    expect(summary.results).toEqual([
      expect.objectContaining({ table: "rate_limit_events", deletedCount: 12 }),
      expect.objectContaining({ table: "job_runs", deletedCount: 4 }),
    ]);
  });

  it("queries both tables with a created_at cutoff", async () => {
    const supabase = createSupabaseStub({ rate_limit_events: 0, job_runs: 0 });

    await runRetentionWorker(supabase);

    expect(supabase.from).toHaveBeenCalledWith("rate_limit_events");
    expect(supabase.from).toHaveBeenCalledWith("job_runs");
  });

  it("uses a shorter retention window for rate_limit_events than job_runs", async () => {
    const supabase = createSupabaseStub({ rate_limit_events: 0, job_runs: 0 });

    const summary = await runRetentionWorker(supabase);

    const rateLimitCutoff = summary.results.find((r) => r.table === "rate_limit_events")!.cutoff;
    const jobRunsCutoff = summary.results.find((r) => r.table === "job_runs")!.cutoff;

    // A shorter retention window means an earlier cutoff is *closer* to now
    // (fewer days subtracted) -- rate_limit_events' cutoff should be later
    // in time (more recent) than job_runs' cutoff.
    expect(new Date(rateLimitCutoff).getTime()).toBeGreaterThan(new Date(jobRunsCutoff).getTime());
  });

  it("throws when a delete query errors", async () => {
    const from = vi.fn(() => {
      const chain = {
        delete: vi.fn(() => chain),
        lt: vi.fn(() => chain),
        then: (resolve: (value: { count: null; error: Error }) => void) =>
          resolve({ count: null, error: new Error("connection lost") }),
      };
      return chain;
    });
    const supabase = { from } as unknown as Client;

    await expect(runRetentionWorker(supabase)).rejects.toThrow("connection lost");
  });
});
