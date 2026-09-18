import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// Batch 5: mocks for runWarmupCycleWorker's multi-org claim regression test
// below. Every function warmup-worker.ts imports from "@/lib/db" must be
// present here (vi.mock replaces the whole module) even though this test
// only exercises a subset of them.
const {
  claimDueWarmupSendsMock,
  releaseWarmupProfileLockMock,
  getMailboxCredentialsMock,
  listDueWarmupRepliesMock,
  listWarmupMessagesSentOnDateMock,
  countWarmupMessagesReceivedOnDateMock,
  upsertWarmupStatMock,
} = vi.hoisted(() => ({
  claimDueWarmupSendsMock: vi.fn(),
  releaseWarmupProfileLockMock: vi.fn(),
  getMailboxCredentialsMock: vi.fn(),
  listDueWarmupRepliesMock: vi.fn(),
  listWarmupMessagesSentOnDateMock: vi.fn(),
  countWarmupMessagesReceivedOnDateMock: vi.fn(),
  upsertWarmupStatMock: vi.fn(),
}));

// Safe default so the pre-existing processClaimedWarmupProfiles tests below
// (which never configure this mock themselves) don't crash on
// `releaseWarmupProfileLock(...).catch(...)` — clearAllMocks() in this
// file's beforeEach clears call history but not this implementation.
releaseWarmupProfileLockMock.mockResolvedValue(undefined);

vi.mock("@/lib/db", () => ({
  claimDueWarmupSends: claimDueWarmupSendsMock,
  releaseWarmupProfileLock: releaseWarmupProfileLockMock,
  updateWarmupProfile: vi.fn(),
  insertWarmupEvent: vi.fn(),
  insertWarmupMessage: vi.fn(),
  updateWarmupMessage: vi.fn(),
  getWarmupMessageByProviderMessageId: vi.fn(),
  listDueWarmupReplies: listDueWarmupRepliesMock,
  countWarmupMessagesSentToday: vi.fn(),
  listWarmupMessagesSentOnDate: listWarmupMessagesSentOnDateMock,
  countWarmupMessagesReceivedOnDate: countWarmupMessagesReceivedOnDateMock,
  upsertWarmupStat: upsertWarmupStatMock,
  listWarmupProfiles: vi.fn(),
  getMailboxCredentials: getMailboxCredentialsMock,
}));

import {
  classifyWarmupFailure,
  processClaimedWarmupProfiles,
  runWarmupCycleWorker,
  selectWarmupPeer,
  type ProcessWarmupProfileOutcome,
  type WarmupCycleSummary,
} from "./warmup-worker";

function makeProfile(id: string, overrides: Partial<Tables<"warmup_profiles">> = {}): Tables<"warmup_profiles"> {
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
    last_ramp_increase_at: null,
    next_send_at: null,
    locked_until: null,
    imap_uid_validity: null,
    imap_last_uid: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function emptySummary(): WarmupCycleSummary {
  return { claimed: 0, sent: 0, repliesSent: 0, bounced: 0, paused: 0, skipped: 0 };
}

const supabaseStub = {} as unknown as Client;

// Mirrors send-worker.test.ts's processClaimedLeads tests: exercises this
// loop's own tally/error-handling/lease-release logic via an injected
// processOne, without re-mocking the DB/SMTP/IMAP-heavy processWarmupProfile
// this orchestration wraps in production (see runWarmupCycleWorker).
describe("processClaimedWarmupProfiles", () => {
  it("tallies sent/repliesSent/bounced/paused from each outcome", async () => {
    const profiles = [makeProfile("a"), makeProfile("b")];
    const outcomes: Record<string, ProcessWarmupProfileOutcome> = {
      a: { sent: 1, repliesSent: 0, bounced: 0, paused: false },
      b: { sent: 0, repliesSent: 2, bounced: 1, paused: true },
    };
    const processOne = async (_supabase: Client, profile: Tables<"warmup_profiles">) => outcomes[profile.id];

    const summary = emptySummary();
    await processClaimedWarmupProfiles(supabaseStub, profiles, summary, false, processOne);

    expect(summary).toEqual({ claimed: 0, sent: 1, repliesSent: 2, bounced: 1, paused: 1, skipped: 0 });
  });

  it("counts a profile with no send and no reply as skipped, unless it was paused", async () => {
    const profiles = [makeProfile("a"), makeProfile("b")];
    const outcomes: Record<string, ProcessWarmupProfileOutcome> = {
      a: { sent: 0, repliesSent: 0, bounced: 0, paused: false },
      b: { sent: 0, repliesSent: 0, bounced: 0, paused: true },
    };
    const processOne = async (_supabase: Client, profile: Tables<"warmup_profiles">) => outcomes[profile.id];

    const summary = emptySummary();
    await processClaimedWarmupProfiles(supabaseStub, profiles, summary, false, processOne);

    expect(summary.skipped).toBe(1);
    expect(summary.paused).toBe(1);
  });

  it("counts a throwing profile as skipped and continues to the next one", async () => {
    const profiles = [makeProfile("a"), makeProfile("b")];
    const processed: string[] = [];
    const processOne = async (_supabase: Client, profile: Tables<"warmup_profiles">): Promise<ProcessWarmupProfileOutcome> => {
      processed.push(profile.id);
      if (profile.id === "a") throw new Error("boom");
      return { sent: 1, repliesSent: 0, bounced: 0, paused: false };
    };

    const summary = emptySummary();
    await processClaimedWarmupProfiles(supabaseStub, profiles, summary, false, processOne);

    expect(processed).toEqual(["a", "b"]);
    expect(summary.skipped).toBe(1);
    expect(summary.sent).toBe(1);
  });
});

describe("selectWarmupPeer", () => {
  it("never selects the caller's own mailbox", () => {
    const candidates = [
      { mailbox_id: "self", status: "enabled" },
      { mailbox_id: "peer", status: "enabled" },
    ];
    for (let i = 0; i < 20; i++) {
      expect(selectWarmupPeer(candidates, "self")?.mailbox_id).toBe("peer");
    }
  });

  it("excludes disabled/paused peers", () => {
    const candidates = [
      { mailbox_id: "self", status: "enabled" },
      { mailbox_id: "paused-peer", status: "paused" },
      { mailbox_id: "disabled-peer", status: "disabled" },
    ];
    expect(selectWarmupPeer(candidates, "self")).toBeNull();
  });

  it("returns null when no eligible peer exists", () => {
    expect(selectWarmupPeer([{ mailbox_id: "self", status: "enabled" }], "self")).toBeNull();
  });

  it("picks among multiple eligible peers", () => {
    const candidates = [
      { mailbox_id: "self", status: "enabled" },
      { mailbox_id: "peer-1", status: "enabled" },
      { mailbox_id: "peer-2", status: "enabled" },
    ];
    const seen = new Set(Array.from({ length: 50 }, () => selectWarmupPeer(candidates, "self")?.mailbox_id));
    expect(seen.has("peer-1")).toBe(true);
    expect(seen.has("peer-2")).toBe(true);
    expect(seen.has("self")).toBe(false);
  });
});

// Batch 5: regression coverage for the fix removing
// WARMUP_ENGINE_ORGANIZATION_ID / lib/warmup/owner-scope.ts. Profiles are
// given stage "healthy" (outside forecastNextRamp's ramping stages) and
// status "paused" so advanceRampAndStage and the send/peer-selection branch
// are no-ops, isolating the assertions to exactly what changed: the claim
// call itself and that a multi-org claimed batch is processed without a
// worker-side organization filter reappearing.
describe("runWarmupCycleWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMailboxCredentialsMock.mockImplementation(async (_supabase: Client, mailboxId: string) => ({
      id: mailboxId,
      imap_enabled: false,
    }));
    listDueWarmupRepliesMock.mockResolvedValue([]);
    listWarmupMessagesSentOnDateMock.mockResolvedValue([]);
    countWarmupMessagesReceivedOnDateMock.mockResolvedValue(0);
    upsertWarmupStatMock.mockResolvedValue({ id: "stat-1" });
    releaseWarmupProfileLockMock.mockResolvedValue(undefined);
  });

  it("claims without any organization filter", async () => {
    claimDueWarmupSendsMock.mockResolvedValue([]);
    const supabase = {} as unknown as Client;

    await runWarmupCycleWorker(supabase, { limit: 7 });

    expect(claimDueWarmupSendsMock).toHaveBeenCalledWith(supabase, 7);
    expect(claimDueWarmupSendsMock.mock.calls[0]).toHaveLength(2);
  });

  it("processes profiles claimed from multiple organizations in a single cycle", async () => {
    const orgAProfile = makeProfile("a", { organization_id: "org-a", stage: "healthy", status: "paused" });
    const orgBProfile = makeProfile("b", { organization_id: "org-b", stage: "healthy", status: "paused" });
    claimDueWarmupSendsMock.mockResolvedValue([orgAProfile, orgBProfile]);
    const supabase = {} as unknown as Client;

    const summary = await runWarmupCycleWorker(supabase);

    expect(summary.claimed).toBe(2);
    expect(getMailboxCredentialsMock).toHaveBeenCalledWith(supabase, "mailbox-a");
    expect(getMailboxCredentialsMock).toHaveBeenCalledWith(supabase, "mailbox-b");
    expect(releaseWarmupProfileLockMock).toHaveBeenCalledWith(supabase, "a");
    expect(releaseWarmupProfileLockMock).toHaveBeenCalledWith(supabase, "b");
    // Each profile's own organization_id is what stats get recorded under —
    // never a shared/hardcoded id, and never swapped between the two.
    expect(upsertWarmupStatMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organization_id: "org-a" }));
    expect(upsertWarmupStatMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organization_id: "org-b" }));
  });
});

describe("classifyWarmupFailure", () => {
  it("pauses immediately on a bounce, regardless of prior failure count", () => {
    expect(classifyWarmupFailure("bounced", 0, 3)).toEqual({ consecutiveFailures: 1, shouldPause: true });
  });

  it("does not pause on the first non-bounce failure below the threshold", () => {
    expect(classifyWarmupFailure("failed", 0, 3)).toEqual({ consecutiveFailures: 1, shouldPause: false });
    expect(classifyWarmupFailure("retry", 1, 3)).toEqual({ consecutiveFailures: 2, shouldPause: false });
  });

  it("pauses once consecutive non-bounce failures reach the threshold", () => {
    expect(classifyWarmupFailure("failed", 2, 3)).toEqual({ consecutiveFailures: 3, shouldPause: true });
  });
});
