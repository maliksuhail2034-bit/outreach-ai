import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// Warmup monitoring that used to live in the GitHub warmup workflow's shell
// script (fail on >50% bounces, warn on auto-pauses) now comes from the
// worker itself, so it survives that workflow's retirement once pg_cron
// schedules the cycle. Also: a profile whose cycle throws is alerted, not
// only logged. Only the database boundary and error tracking are mocked.

const db = vi.hoisted(() => ({
  claimDueWarmupSends: vi.fn(),
  releaseWarmupProfileLock: vi.fn(),
  getMailboxCredentials: vi.fn(),
}));
const captureError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError }));

import {
  processClaimedWarmupProfiles,
  reportDegradedWarmupRun,
  runWarmupCycleWorker,
  type ProcessWarmupProfileOutcome,
  type WarmupCycleSummary,
} from "./warmup-worker";

const supabase = {} as unknown as Client;

function summary(overrides: Partial<WarmupCycleSummary> = {}): WarmupCycleSummary {
  return { claimed: 0, sent: 0, repliesSent: 0, bounced: 0, paused: 0, skipped: 0, ...overrides };
}

function profile(id: string): Tables<"warmup_profiles"> {
  return {
    id,
    organization_id: "org-1",
    mailbox_id: `mailbox-${id}`,
    status: "enabled",
    stage: "warming",
    target_daily_volume: 30,
    current_daily_volume: 10,
    ramp_up_percent: 20,
    health_score: 50,
    consecutive_failures: 0,
    started_at: "2026-08-01T00:00:00Z",
    last_activity_at: null,
    last_ramp_increase_at: new Date().toISOString(),
    next_send_at: null,
    locked_until: null,
    imap_uid_validity: null,
    imap_last_uid: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  captureError.mockResolvedValue(undefined);
  db.releaseWarmupProfileLock.mockResolvedValue(undefined);
});

describe("reportDegradedWarmupRun — the workflow's checks, from the worker", () => {
  it("alerts when bounces exceed half of the claimed profiles", async () => {
    await reportDegradedWarmupRun(summary({ claimed: 3, sent: 1, bounced: 2 }));

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith({
      job: "warmup-cycle",
      message: "Degraded warmup run: high bounce rate: 2 bounce(s) across 3 profile(s)",
      context: { claimed: 3, sent: 1, bounced: 2, paused: 0 },
    });
  });

  it("does not alert at exactly half, matching the workflow's strict threshold", async () => {
    await reportDegradedWarmupRun(summary({ claimed: 4, bounced: 2 }));
    expect(captureError).not.toHaveBeenCalled();
  });

  it("alerts when any profile was auto-paused", async () => {
    await reportDegradedWarmupRun(summary({ claimed: 3, sent: 2, paused: 1 }));

    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Degraded warmup run: 1 profile(s) auto-paused — check the Warmup dashboard" }),
    );
  });

  it("names both reasons in one alert when both apply", async () => {
    await reportDegradedWarmupRun(summary({ claimed: 2, bounced: 2, paused: 2 }));

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][0].message).toBe(
      "Degraded warmup run: high bounce rate: 2 bounce(s) across 2 profile(s); 2 profile(s) auto-paused — check the Warmup dashboard",
    );
  });

  it.each([
    ["nothing was claimed", summary()],
    ["a normal run", summary({ claimed: 3, sent: 3, repliesSent: 2 })],
  ])("does not alert for %s", async (_label, value) => {
    await reportDegradedWarmupRun(value);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("never throws, even if the alert itself fails", async () => {
    captureError.mockRejectedValue(new Error("webhook down"));
    await expect(reportDegradedWarmupRun(summary({ claimed: 1, paused: 1 }))).resolves.toBeUndefined();
  });
});

describe("processClaimedWarmupProfiles — a profile whose cycle throws is alerted", () => {
  it("alerts once with the profile, mailbox and real error, then carries on and releases every lease", async () => {
    const processOne = async (_s: Client, claimed: Tables<"warmup_profiles">): Promise<ProcessWarmupProfileOutcome> => {
      if (claimed.id === "a") throw { message: "canceling statement due to statement timeout", details: "row data" };
      return { sent: 1, repliesSent: 0, bounced: 0, paused: false };
    };
    const result = summary();

    await processClaimedWarmupProfiles(supabase, [profile("a"), profile("b")], result, false, processOne);

    expect(result).toMatchObject({ sent: 1, skipped: 1 });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith({
      job: "warmup-cycle",
      message: "Warmup cycle failed for a profile: canceling statement due to statement timeout",
      context: { warmupProfileId: "a", mailboxId: "mailbox-a" },
    });
    expect(db.releaseWarmupProfileLock).toHaveBeenCalledWith(supabase, "a");
    expect(db.releaseWarmupProfileLock).toHaveBeenCalledWith(supabase, "b");
  });

  it("does not alert when every profile's cycle completes", async () => {
    const processOne = async (): Promise<ProcessWarmupProfileOutcome> => ({ sent: 1, repliesSent: 1, bounced: 0, paused: false });

    await processClaimedWarmupProfiles(supabase, [profile("a")], summary(), false, processOne);

    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("runWarmupCycleWorker — monitoring is wired into the real cycle", () => {
  it("sends no alert when nothing is due", async () => {
    db.claimDueWarmupSends.mockResolvedValue([]);

    await expect(runWarmupCycleWorker(supabase)).resolves.toEqual(summary());
    expect(captureError).not.toHaveBeenCalled();
  });

  it("alerts a profile whose cycle fails, and still completes the run", async () => {
    db.claimDueWarmupSends.mockResolvedValue([profile("a")]);
    db.getMailboxCredentials.mockRejectedValue(new Error("mailbox read failed"));

    const result = await runWarmupCycleWorker(supabase);

    expect(result).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "warmup-cycle",
        message: "Warmup cycle failed for a profile: mailbox read failed",
        context: { warmupProfileId: "a", mailboxId: "mailbox-a" },
      }),
    );
    expect(db.releaseWarmupProfileLock).toHaveBeenCalledWith(supabase, "a");
  });
});
