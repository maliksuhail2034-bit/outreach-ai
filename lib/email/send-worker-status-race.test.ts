import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// The worker side of the claim-to-send status race
// (supabase/migrations/20260927100000_send_status_race_guard.sql): drives the
// real runSendWorker -> processCampaignLead path with the database layer and
// provider mocked, and proves the provider is never called once
// confirm_send_attempt_eligible refuses. The database side — the check
// itself, the reply write racing it, and record_send_success/failure not
// overwriting a newer status — runs against real Postgres in
// supabase/tests/send_status_race.test.sql.

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
const ALWAYS_OPEN = { days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], startHour: 0, endHour: 24, timezone: "UTC" };

function claimedLead(overrides: Partial<Tables<"campaign_leads">> = {}): Tables<"campaign_leads"> {
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
    ...overrides,
  };
}

function step(id: string, order: number) {
  return { id, sequence_id: "seq-1", step_order: order, day_delay: 1, subject: "Hi", body: "Hello", created_at: "", updated_at: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-unsubscribe-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");

  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: ALWAYS_OPEN });
  db.getLeadById.mockResolvedValue({ id: "lead-1", email: "lead@example.test", first_name: "Ada", last_name: null, company: null, title: null, custom_fields: null });
  db.getMailboxCredentials.mockResolvedValue({ id: "mailbox-1", email: "sender@example.test", display_name: "Sender" });
  db.listSequences.mockResolvedValue([{ id: "seq-1" }]);
  db.listSequenceSteps.mockResolvedValue([step("step-1", 0), step("step-2", 1)]);
  db.getSuppression.mockResolvedValue(null);
  db.claimSendAttempt.mockResolvedValue({ id: "attempt-1", attempt_count: 1 });
  db.getSettings.mockResolvedValue({ tracking_enabled: false, unsubscribe_text: null });
  db.listAttachmentsForStepScoped.mockResolvedValue([]);
  db.consumeSendNow.mockResolvedValue(true);
  send.mockResolvedValue({ providerMessageId: "provider-msg-1" });
  db.updateClaimedCampaignLead.mockResolvedValue(true);
});

describe("send worker — lead status changed between claim and send", () => {
  it.each(["lead_replied", "lead_cancelled", "lead_unsubscribed", "lead_removed", "step_changed", "campaign_paused"])(
    "does not call the provider when the pre-send check returns %s",
    async (reason) => {
      db.claimDueSends.mockResolvedValue([claimedLead()]);
      db.confirmSendAttemptEligible.mockResolvedValue(reason);

      const summary = await runSendWorker(supabase, 1, 1);

      expect(db.confirmSendAttemptEligible).toHaveBeenCalledWith(supabase, "attempt-1", "cl-1", "step-1");
      expect(send).not.toHaveBeenCalled();
      expect(db.recordSendSuccess).not.toHaveBeenCalled();
      expect(db.recordSendFailure).not.toHaveBeenCalled();
      // The RPC already released the lease and left the lead's own state alone;
      // the worker writes nothing more to the row.
      expect(db.updateCampaignLead).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    },
  );

  it("checks eligibility after the idempotency claim and immediately before the provider call", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.confirmSendAttemptEligible.mockResolvedValue("ok");

    await runSendWorker(supabase, 1, 1);

    const claimOrder = db.claimSendAttempt.mock.invocationCallOrder[0];
    const checkOrder = db.confirmSendAttemptEligible.mock.invocationCallOrder[0];
    const sendOrder = send.mock.invocationCallOrder[0];
    const attachmentsOrder = db.listAttachmentsForStepScoped.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(checkOrder);
    expect(attachmentsOrder).toBeLessThan(checkOrder);
    expect(checkOrder).toBeLessThan(sendOrder);
  });

  it("still sends a normal active lead and records the success with the next step", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.confirmSendAttemptEligible.mockResolvedValue("ok");

    const summary = await runSendWorker(supabase, 1, 1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(db.recordSendSuccess).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        sendAttemptId: "attempt-1",
        campaignLeadId: "cl-1",
        providerMessageId: "provider-msg-1",
        nextStatus: "active",
        nextStepId: "step-2",
      }),
    );
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
  });

  it("still sends an eligible Send Now lead (bypass consumed first, then the check)", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead({ send_now_step_id: "step-1" })]);
    db.confirmSendAttemptEligible.mockResolvedValue("ok");

    const summary = await runSendWorker(supabase, 1, 1);

    expect(db.consumeSendNow).toHaveBeenCalledWith(supabase, "cl-1", "step-1", "step-1");
    expect(db.consumeSendNow.mock.invocationCallOrder[0]).toBeLessThan(db.confirmSendAttemptEligible.mock.invocationCallOrder[0]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ sent: 1 });
  });

  it("keeps the earlier suppression re-check: a suppressed lead is skipped before any attempt or check", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.getSuppression.mockResolvedValue({ reason: "unsubscribed" });

    await runSendWorker(supabase, 1, 1);

    expect(db.claimSendAttempt).not.toHaveBeenCalled();
    expect(db.confirmSendAttemptEligible).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(db.updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      status: "unsubscribed",
      next_send_at: null,
      locked_until: null,
    });
  });

  it("treats a failure of the check itself like any pre-send failure: no send, recorded for retry", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.confirmSendAttemptEligible.mockRejectedValue(new Error("connection reset"));

    await runSendWorker(supabase, 1, 1);

    expect(send).not.toHaveBeenCalled();
    expect(db.recordSendFailure).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ sendAttemptId: "attempt-1", outcome: "retry" }),
    );
  });
});

// The other writes the worker makes from its claimed copy of the row
// (needs_review, and the "already sent" self-heal) go through
// updateClaimedCampaignLead's status/step guard, never a plain update. That
// guard's own filters are pinned in lib/db/campaign-leads.test.ts and its
// effect on real rows in supabase/tests/send_status_race.test.sql.
describe("send worker — stale writes from the claimed copy are guarded", () => {
  it("flags a malformed claim (no step) for review only while the lead is still active", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead({ current_step_id: null })]);

    const summary = await runSendWorker(supabase, 1, 1);

    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", {
      status: "needs_review",
      last_error: "Claimed with no current_step_id or mailbox_id.",
      locked_until: null,
    });
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ needsReview: 1 });
  });

  it("flags an unknown claimed step for review only while the lead is still active on that step", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead({ current_step_id: "step-gone" })]);

    await runSendWorker(supabase, 1, 1);

    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      { status: "needs_review", last_error: "current_step_id does not match any step in this sequence.", locked_until: null },
      "step-gone",
    );
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("self-heals an already-sent step only while the lead is still active on that step", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.claimSendAttempt.mockResolvedValue(null);
    db.getSendAttempt.mockResolvedValue({ status: "sent", resolved_at: "2026-09-20T10:00:00Z", claimed_at: "2026-09-20T10:00:00Z" });

    const summary = await runSendWorker(supabase, 1, 1);

    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      expect.objectContaining({ status: "active", current_step_id: "step-2", locked_until: null }),
      "step-1",
    );
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
    expect(db.recordSendSuccess).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ skipped: 1 });
  });

  it("flags an unknown-outcome attempt for review only while the lead is still active on that step", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.claimSendAttempt.mockResolvedValue(null);
    db.getSendAttempt.mockResolvedValue({ status: "pending" });

    const summary = await runSendWorker(supabase, 1, 1);

    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      { status: "needs_review", locked_until: null },
      "step-1",
    );
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ needsReview: 1 });
  });

  it("does not count a lead as needing review when the guard found it already left 'active' (e.g. replied)", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead()]);
    db.claimSendAttempt.mockResolvedValue(null);
    db.getSendAttempt.mockResolvedValue({ status: "pending" });
    db.updateClaimedCampaignLead.mockResolvedValue(false);

    const summary = await runSendWorker(supabase, 1, 1);

    expect(summary).toMatchObject({ needsReview: 0, skipped: 1 });
  });
});
