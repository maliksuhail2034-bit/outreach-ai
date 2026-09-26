import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// Where the sending-window check sits in the real worker pipeline
// (runSendWorker → processCampaignLead): after the monthly-limit check,
// before claimSendAttempt and the provider. enforceSendingWindow's own
// decisions are covered in send-worker.test.ts; this file only pins the
// ordering, so every lib/db call is mocked and claimSendAttempt stops the
// pipeline with a sentinel as soon as it's reached.
vi.mock("@/lib/db", () => ({
  claimDueSends: vi.fn(),
  claimSendAttempt: vi.fn(),
  consumeSendNow: vi.fn(),
  deferDueCampaignLeads: vi.fn(),
  getCampaignById: vi.fn(),
  getLeadById: vi.fn(),
  getMailboxCredentials: vi.fn(),
  getSendAttempt: vi.fn(),
  getSettings: vi.fn(),
  getSuppression: vi.fn(),
  listAttachmentsForStepScoped: vi.fn(),
  listSequenceSteps: vi.fn(),
  listSequences: vi.fn(),
  recordSendFailure: vi.fn(),
  recordSendSuccess: vi.fn(),
  updateCampaignLead: vi.fn(),
}));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: vi.fn() }));
vi.mock("./get-provider", () => ({ getEmailProvider: vi.fn() }));

import {
  claimDueSends,
  claimSendAttempt,
  consumeSendNow,
  deferDueCampaignLeads,
  getCampaignById,
  getLeadById,
  getMailboxCredentials,
  getSuppression,
  listSequenceSteps,
  listSequences,
  updateCampaignLead,
} from "@/lib/db";
import { isWithinMonthlyEmailLimit } from "@/lib/billing/limits";
import { getEmailProvider } from "./get-provider";
import { runSendWorker } from "./send-worker";

const supabase = {} as unknown as Client;

const DUBAI_SUN_TO_THU = { days: ["sun", "mon", "tue", "wed", "thu"], startHour: 9, endHour: 17, timezone: "Asia/Dubai" };
const INSIDE = new Date("2026-09-23T06:00:00.000Z"); // Wed 10:00 Dubai
const OUTSIDE = new Date("2026-09-25T05:06:00.000Z"); // Fri 09:06 Dubai (Fri disabled)
const NEXT_OPENING = "2026-09-27T05:00:00.000Z"; // Sun 09:00 Dubai

const REACHED_CLAIM = new Error("reached claimSendAttempt");

function makeLead(overrides: Partial<Tables<"campaign_leads">> = {}): Tables<"campaign_leads"> {
  return {
    id: "cl-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    current_step_id: "step-1",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    enrolled_at: "2026-01-01T00:00:00Z",
    last_error: null,
    locked_until: null,
    next_send_at: "2026-09-01T00:00:00Z",
    send_now_step_id: null,
    ...overrides,
  };
}

function claim(lead: Tables<"campaign_leads">) {
  vi.mocked(claimDueSends).mockResolvedValue([lead] as never);
}

function callOrder(fn: unknown) {
  return vi.mocked(fn as (...args: unknown[]) => unknown).mock.invocationCallOrder;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.mocked(getCampaignById).mockResolvedValue({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: DUBAI_SUN_TO_THU } as never);
  vi.mocked(getLeadById).mockResolvedValue({ id: "lead-1", email: "lead@example.com" } as never);
  vi.mocked(getMailboxCredentials).mockResolvedValue({ id: "mailbox-1" } as never);
  vi.mocked(listSequences).mockResolvedValue([{ id: "sequence-1" }] as never);
  vi.mocked(listSequenceSteps).mockResolvedValue([{ id: "step-1", step_order: 0 }, { id: "step-2", step_order: 1 }] as never);
  vi.mocked(getSuppression).mockResolvedValue(null as never);
  vi.mocked(isWithinMonthlyEmailLimit).mockResolvedValue(true);
  vi.mocked(updateCampaignLead).mockResolvedValue(makeLead() as never);
  vi.mocked(deferDueCampaignLeads).mockResolvedValue(undefined);
  vi.mocked(consumeSendNow).mockResolvedValue(true);
  vi.mocked(claimSendAttempt).mockRejectedValue(REACHED_CLAIM);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("send worker: sending-window enforcement ordering", () => {
  it("sends a normal due lead inside the window with no extra writes before claimSendAttempt", async () => {
    vi.setSystemTime(INSIDE);
    claim(makeLead());

    await expect(runSendWorker(supabase, 25, 1)).rejects.toBe(REACHED_CLAIM);
    expect(updateCampaignLead).not.toHaveBeenCalled();
    expect(deferDueCampaignLeads).not.toHaveBeenCalled();
  });

  it("defers an outside-window lead (and the rest of its campaign) without ever reaching claimSendAttempt or the provider", async () => {
    vi.setSystemTime(OUTSIDE);
    claim(makeLead());

    await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      next_send_at: NEXT_OPENING,
      locked_until: null,
      send_now_step_id: null,
    });
    expect(deferDueCampaignLeads).toHaveBeenCalledWith(supabase, "campaign-1", new Date(NEXT_OPENING), OUTSIDE);
    expect(claimSendAttempt).not.toHaveBeenCalled();
    expect(getEmailProvider).not.toHaveBeenCalled();
  });

  it("consumes a still-present Send Now bypass outside the window strictly before claimSendAttempt, then sends", async () => {
    vi.setSystemTime(OUTSIDE);
    claim(makeLead({ send_now_step_id: "step-1" }));

    await expect(runSendWorker(supabase, 25, 1)).rejects.toBe(REACHED_CLAIM);
    expect(consumeSendNow).toHaveBeenCalledTimes(1);
    expect(consumeSendNow).toHaveBeenCalledWith(supabase, "cl-1", "step-1", "step-1");
    expect(callOrder(consumeSendNow)[0]).toBeLessThan(callOrder(claimSendAttempt)[0]);
    expect(updateCampaignLead).not.toHaveBeenCalled();
    expect(deferDueCampaignLeads).not.toHaveBeenCalled();
    // The campaign is only read once (by processCampaignLead) — no re-check
    // is needed when the conditional consume matched.
    expect(getCampaignById).toHaveBeenCalledTimes(1);
  });

  // B1: the claim returned the lead with its bypass, then the campaign was
  // paused before the worker reached the window check. The pause trigger
  // cleared send_now_step_id in the database, so the conditional consume
  // matches 0 rows even though the worker's claimed copy still shows it.
  describe("stale claimed bypass after a pause (conditional consume matches 0 rows)", () => {
    beforeEach(() => {
      vi.mocked(consumeSendNow).mockResolvedValue(false);
      vi.mocked(getCampaignById)
        .mockResolvedValueOnce({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: DUBAI_SUN_TO_THU } as never)
        .mockResolvedValueOnce({ id: "campaign-1", user_id: "user-1", status: "paused", sending_window: DUBAI_SUN_TO_THU } as never);
    });

    for (const [label, at] of [["outside", OUTSIDE], ["inside", INSIDE]] as const) {
      it(`never sends — not claimSendAttempt, not the provider — ${label} the window`, async () => {
        vi.setSystemTime(at);
        claim(makeLead({ send_now_step_id: "step-1" }));

        await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
        expect(consumeSendNow).toHaveBeenCalledWith(supabase, "cl-1", "step-1", "step-1");
        expect(claimSendAttempt).not.toHaveBeenCalled();
        expect(getEmailProvider).not.toHaveBeenCalled();
        // Lease released, schedule kept: a resume goes through the normal
        // window check. Nothing else is written.
        expect(updateCampaignLead).toHaveBeenCalledTimes(1);
        expect(updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", { locked_until: null });
        expect(deferDueCampaignLeads).not.toHaveBeenCalled();
      });
    }
  });

  it("with a lost bypass on a still-active campaign, falls back to the normal window decision (deferred outside it)", async () => {
    vi.setSystemTime(OUTSIDE);
    vi.mocked(consumeSendNow).mockResolvedValue(false);
    claim(makeLead({ send_now_step_id: "step-1" }));

    await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ skipped: 1, sent: 0 });
    expect(claimSendAttempt).not.toHaveBeenCalled();
    expect(updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      next_send_at: NEXT_OPENING,
      locked_until: null,
      send_now_step_id: null,
    });
  });

  it("with a lost bypass on a still-active campaign inside the window, sends normally", async () => {
    vi.setSystemTime(INSIDE);
    vi.mocked(consumeSendNow).mockResolvedValue(false);
    claim(makeLead({ send_now_step_id: "step-1" }));

    await expect(runSendWorker(supabase, 25, 1)).rejects.toBe(REACHED_CLAIM);
    expect(consumeSendNow).toHaveBeenCalledTimes(1);
  });

  it("does not let a Send Now for step 1 carry a step-2 lead outside the window", async () => {
    vi.setSystemTime(OUTSIDE);
    claim(makeLead({ current_step_id: "step-2", send_now_step_id: "step-1" }));

    await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ skipped: 1 });
    expect(claimSendAttempt).not.toHaveBeenCalled();
  });

  it("clears a pending Send Now on a monthly-limit deferral, before any window check or send", async () => {
    vi.setSystemTime(OUTSIDE);
    vi.mocked(isWithinMonthlyEmailLimit).mockResolvedValue(false);
    claim(makeLead({ send_now_step_id: "step-1" }));

    await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ skipped: 1 });
    expect(updateCampaignLead).toHaveBeenCalledTimes(1);
    expect(updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      next_send_at: "2026-10-01T00:00:00.000Z",
      locked_until: null,
      send_now_step_id: null,
    });
    expect(deferDueCampaignLeads).not.toHaveBeenCalled();
    expect(claimSendAttempt).not.toHaveBeenCalled();
  });
});
