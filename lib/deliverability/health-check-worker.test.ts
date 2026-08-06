import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Client } from "@/lib/db/shared";

const { getWarmupProfileByMailboxIdMock, getMailboxHealthByMailboxIdMock, listActiveMailboxesForHealthCheckMock, upsertMailboxHealthMock } =
  vi.hoisted(() => ({
    getWarmupProfileByMailboxIdMock: vi.fn(),
    getMailboxHealthByMailboxIdMock: vi.fn(),
    listActiveMailboxesForHealthCheckMock: vi.fn(),
    upsertMailboxHealthMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  getWarmupProfileByMailboxId: getWarmupProfileByMailboxIdMock,
  getMailboxHealthByMailboxId: getMailboxHealthByMailboxIdMock,
  listActiveMailboxesForHealthCheck: listActiveMailboxesForHealthCheckMock,
  upsertMailboxHealth: upsertMailboxHealthMock,
}));

import { runDeliverabilityHealthCheckWorker } from "./health-check-worker";

const supabase = {} as unknown as Client;

const MAILBOX_A = { id: "mailbox-a", user_id: "user-a", status: "active" };
const MAILBOX_B = { id: "mailbox-b", user_id: "user-b", status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
  getWarmupProfileByMailboxIdMock.mockResolvedValue(null);
  getMailboxHealthByMailboxIdMock.mockResolvedValue(null);
  upsertMailboxHealthMock.mockResolvedValue({ id: "health-1" });
});

describe("runDeliverabilityHealthCheckWorker", () => {
  it("recalculates health for every active mailbox and reports the summary", async () => {
    listActiveMailboxesForHealthCheckMock.mockResolvedValue([MAILBOX_A, MAILBOX_B]);

    const summary = await runDeliverabilityHealthCheckWorker(supabase);

    expect(summary).toEqual({ checked: 2, updated: 2, failed: 0 });
    expect(upsertMailboxHealthMock).toHaveBeenCalledTimes(2);
    expect(upsertMailboxHealthMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mailbox_id: MAILBOX_A.id, user_id: MAILBOX_A.user_id }),
    );
  });

  it("derives warmup_status from an enrolled warmup profile's stage", async () => {
    listActiveMailboxesForHealthCheckMock.mockResolvedValue([MAILBOX_A]);
    getWarmupProfileByMailboxIdMock.mockResolvedValue({ mailbox_id: MAILBOX_A.id, stage: "healthy" });

    await runDeliverabilityHealthCheckWorker(supabase);

    expect(upsertMailboxHealthMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ warmup_status: "warmed" }),
    );
  });

  it("falls back to the existing health row's warmup_status when there's no warmup profile", async () => {
    listActiveMailboxesForHealthCheckMock.mockResolvedValue([MAILBOX_A]);
    getWarmupProfileByMailboxIdMock.mockResolvedValue(null);
    getMailboxHealthByMailboxIdMock.mockResolvedValue({ warmup_status: "warming", reputation_score: 80 });

    await runDeliverabilityHealthCheckWorker(supabase);

    expect(upsertMailboxHealthMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ warmup_status: "warming", reputation_score: 80 }),
    );
  });

  it("isolates a single mailbox's failure so the rest of the run still completes", async () => {
    listActiveMailboxesForHealthCheckMock.mockResolvedValue([MAILBOX_A, MAILBOX_B]);
    getWarmupProfileByMailboxIdMock.mockImplementation((_client: unknown, mailboxId: string) => {
      if (mailboxId === MAILBOX_A.id) throw new Error("boom");
      return Promise.resolve(null);
    });

    const summary = await runDeliverabilityHealthCheckWorker(supabase);

    expect(summary).toEqual({ checked: 2, updated: 1, failed: 1 });
    expect(upsertMailboxHealthMock).toHaveBeenCalledTimes(1);
    expect(upsertMailboxHealthMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mailbox_id: MAILBOX_B.id }),
    );
  });

  it("isolates a failing upsert without throwing out of the worker", async () => {
    listActiveMailboxesForHealthCheckMock.mockResolvedValue([MAILBOX_A, MAILBOX_B]);
    upsertMailboxHealthMock.mockImplementation((_client: unknown, values: { mailbox_id: string }) => {
      if (values.mailbox_id === MAILBOX_A.id) return Promise.reject(new Error("db unavailable"));
      return Promise.resolve({ id: "health-2" });
    });

    const summary = await runDeliverabilityHealthCheckWorker(supabase);

    expect(summary).toEqual({ checked: 2, updated: 1, failed: 1 });
  });

  it("returns a zeroed summary when there are no active mailboxes", async () => {
    listActiveMailboxesForHealthCheckMock.mockResolvedValue([]);

    const summary = await runDeliverabilityHealthCheckWorker(supabase);

    expect(summary).toEqual({ checked: 0, updated: 0, failed: 0 });
    expect(upsertMailboxHealthMock).not.toHaveBeenCalled();
  });
});
