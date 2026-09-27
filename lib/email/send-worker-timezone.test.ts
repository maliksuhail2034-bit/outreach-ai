import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// Per-lead timezone through the real runSendWorker -> processCampaignLead
// path (database layer and provider mocked): the final window check,
// same-timezone deferral, follow-up scheduling and the already-sent
// self-heal all use the lead's own window — the campaign's days and hours in
// the lead's timezone — and a lead without one behaves exactly as before.

const db = vi.hoisted(() => ({
  claimDueSends: vi.fn(),
  claimSendAttempt: vi.fn(),
  confirmSendAttemptEligible: vi.fn(),
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
  updateClaimedCampaignLead: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => db);
vi.mock("./get-provider", () => ({ getEmailProvider: () => ({ send }) }));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: async () => true }));
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError: vi.fn() }));

import { runSendWorker } from "./send-worker";

const supabase = {} as unknown as Client;

// Sun-Thu 09:00-17:00 in Dubai (+4).
const DUBAI_SUN_TO_THU = { days: ["sun", "mon", "tue", "wed", "thu"], startHour: 9, endHour: 17, timezone: "Asia/Dubai" };

// Wed 2026-09-23 06:00Z = Wed 10:00 Dubai (open) = Wed 02:00 New York (closed)
const WED_10AM_DUBAI = new Date("2026-09-23T06:00:00.000Z");
// Thu 2026-09-24 17:00Z = Thu 21:00 Dubai (closed) = Thu 10:00 Los Angeles (open)
const THU_10AM_LOS_ANGELES = new Date("2026-09-24T17:00:00.000Z");

function claimedLead(): Tables<"campaign_leads"> {
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
    locked_until: "2099-01-01T00:00:00Z",
    next_send_at: "2026-01-01T00:00:00Z",
    send_now_step_id: null,
  };
}

function useLeadTimezone(timezone: string | null) {
  db.getLeadById.mockResolvedValue({
    id: "lead-1",
    email: "lead@example.test",
    first_name: "Ada",
    last_name: null,
    company: null,
    title: null,
    custom_fields: null,
    timezone,
  });
}

async function runAt(now: Date) {
  vi.setSystemTime(now);
  db.claimDueSends.mockResolvedValue([claimedLead()]);
  return runSendWorker(supabase, 1, 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-unsubscribe-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");

  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: DUBAI_SUN_TO_THU });
  useLeadTimezone(null);
  db.getMailboxCredentials.mockResolvedValue({ id: "mailbox-1", email: "sender@example.test", display_name: "Sender" });
  db.listSequences.mockResolvedValue([{ id: "seq-1" }]);
  db.listSequenceSteps.mockResolvedValue([
    { id: "step-1", sequence_id: "seq-1", step_order: 0, day_delay: 0, subject: "Hi", body: "Hello", created_at: "", updated_at: "" },
    { id: "step-2", sequence_id: "seq-1", step_order: 1, day_delay: 1, subject: "Re: Hi", body: "Following up", created_at: "", updated_at: "" },
  ]);
  db.getSuppression.mockResolvedValue(null);
  db.claimSendAttempt.mockResolvedValue({ id: "attempt-1", attempt_count: 1 });
  db.getSettings.mockResolvedValue({ tracking_enabled: false, unsubscribe_text: null });
  db.listAttachmentsForStepScoped.mockResolvedValue([]);
  db.confirmSendAttemptEligible.mockResolvedValue("ok");
  db.consumeSendNow.mockResolvedValue(true);
  db.updateClaimedCampaignLead.mockResolvedValue(true);
  db.deferDueCampaignLeads.mockResolvedValue(undefined);
  send.mockResolvedValue({ providerMessageId: "provider-msg-1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("send worker — final window check in the lead's timezone", () => {
  it("defers a lead whose own local time is outside the hours, even though the campaign's timezone is inside", async () => {
    useLeadTimezone("America/New_York");

    const summary = await runAt(WED_10AM_DUBAI);

    expect(send).not.toHaveBeenCalled();
    expect(db.claimSendAttempt).not.toHaveBeenCalled();
    expect(db.updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      next_send_at: "2026-09-23T13:00:00.000Z", // Wed 09:00 EDT
      locked_until: null,
      send_now_step_id: null,
    });
    expect(summary).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
  });

  it("only bulk-defers other due leads that share the lead's effective timezone", async () => {
    useLeadTimezone("America/New_York");

    await runAt(WED_10AM_DUBAI);

    const [, campaignId, nextSendAt, , inSameWindow] = db.deferDueCampaignLeads.mock.calls[0] as [
      Client,
      string,
      Date,
      Date,
      (timezone: string | null) => boolean,
    ];
    expect(campaignId).toBe("campaign-1");
    expect(nextSendAt.toISOString()).toBe("2026-09-23T13:00:00.000Z");
    expect(inSameWindow("America/New_York")).toBe(true);
    expect(inSameWindow(null)).toBe(false); // the campaign's Dubai window
    expect(inSameWindow("Asia/Dubai")).toBe(false);
    expect(inSameWindow("Not/A_Zone")).toBe(false); // falls back to Dubai
    expect(inSameWindow("America/Los_Angeles")).toBe(false);
  });

  it("with no lead timezone, groups leads exactly as the campaign timezone (unchanged behavior)", async () => {
    await runAt(THU_10AM_LOS_ANGELES); // Thu 21:00 Dubai: closed

    expect(send).not.toHaveBeenCalled();
    expect(db.updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      next_send_at: "2026-09-27T05:00:00.000Z", // Sun 09:00 Dubai
      locked_until: null,
      send_now_step_id: null,
    });
    const inSameWindow = db.deferDueCampaignLeads.mock.calls[0][4] as (timezone: string | null) => boolean;
    expect(inSameWindow(null)).toBe(true);
    expect(inSameWindow("Not/A_Zone")).toBe(true);
    expect(inSameWindow("Asia/Dubai")).toBe(true);
    expect(inSameWindow("America/New_York")).toBe(false);
  });

  it("sends a lead whose own local time is inside the hours, even though the campaign's timezone is outside", async () => {
    useLeadTimezone("America/Los_Angeles");

    const summary = await runAt(THU_10AM_LOS_ANGELES);

    expect(send).toHaveBeenCalledTimes(1);
    expect(db.deferDueCampaignLeads).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
  });
});

describe("send worker — follow-ups and self-heal in the lead's timezone", () => {
  it("schedules the follow-up in the lead's timezone", async () => {
    useLeadTimezone("America/Los_Angeles");

    await runAt(THU_10AM_LOS_ANGELES);

    // +1 day = Fri 10:00 PDT; Fri and Sat are off, so Sun 09:00 PDT = 16:00Z.
    expect(db.recordSendSuccess).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ nextStepId: "step-2", nextStatus: "active", nextSendAt: "2026-09-27T16:00:00.000Z" }),
    );
  });

  it("schedules the follow-up in the campaign timezone for a lead without one (unchanged behavior)", async () => {
    await runAt(WED_10AM_DUBAI);

    // +1 day = Thu 10:00 Dubai, inside the window.
    expect(db.recordSendSuccess).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ nextStepId: "step-2", nextSendAt: "2026-09-24T06:00:00.000Z" }),
    );
  });

  // Each run happens inside its own window, and the step was sent then; the
  // follow-up is a day later in that same zone.
  it.each([
    // Thu 10:00 PDT + 1 day = Fri (off), Sat (off) -> Sun 09:00 PDT
    ["the lead's timezone", "America/Los_Angeles", THU_10AM_LOS_ANGELES, "2026-09-27T16:00:00.000Z"],
    // Wed 10:00 Dubai + 1 day = Thu 10:00 Dubai
    ["the campaign timezone when the lead has none", null, WED_10AM_DUBAI, "2026-09-24T06:00:00.000Z"],
  ])("advances an already-sent step (self-heal) in %s", async (_label, timezone, sentAt, expected) => {
    useLeadTimezone(timezone);
    db.claimSendAttempt.mockResolvedValue(null);
    db.getSendAttempt.mockResolvedValue({ status: "sent", resolved_at: sentAt.toISOString(), claimed_at: "" });

    await runAt(sentAt);

    expect(send).not.toHaveBeenCalled();
    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      expect.objectContaining({ current_step_id: "step-2", status: "active", next_send_at: expected }),
      "step-1",
    );
  });

  it("never lets a lead timezone bypass the window check for the self-heal path", async () => {
    // Outside the lead's own window, the self-heal isn't reached at all.
    useLeadTimezone("America/New_York");
    db.claimSendAttempt.mockResolvedValue(null);

    await runAt(WED_10AM_DUBAI);

    expect(db.getSendAttempt).not.toHaveBeenCalled();
    expect(db.updateClaimedCampaignLead).not.toHaveBeenCalled();
  });
});
