import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// M3: unexpected errors in the send worker. Drives the real runSendWorker ->
// processCampaignLead path with the database layer and provider mocked, same
// harness as send-worker-status-race.test.ts, and pins three guarantees:
//   - one lead's unexpected error never fails the run or touches other leads;
//   - once the provider has accepted an email, nothing records it as a
//     failure (which would re-claim and resend it) — it goes to needs_review;
//   - preparing the message happens before the idempotency claim, so a
//     throw there leaves no 'pending' attempt behind.

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
  markMailboxErrored: vi.fn(),
  recordSendFailure: vi.fn(),
  recordSendSuccess: vi.fn(),
  updateCampaignLead: vi.fn(),
  updateClaimedCampaignLead: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => db);
vi.mock("./get-provider", () => ({ getEmailProvider: () => ({ send }) }));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: async () => true }));
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError }));

import { runSendWorker } from "./send-worker";

const supabase = {} as unknown as Client;
const ALWAYS_OPEN = { days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], startHour: 0, endHour: 24, timezone: "UTC" };
// PostgREST errors reach the worker as plain objects, not Error instances.
const DB_ERROR = { message: "canceling statement due to statement timeout", details: null, hint: null, code: "57014" };

function claimedLead(id: string, leadId: string, mailboxId: string): Tables<"campaign_leads"> {
  return {
    id,
    campaign_id: "campaign-1",
    lead_id: leadId,
    mailbox_id: mailboxId,
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

function step(id: string, order: number) {
  return { id, sequence_id: "seq-1", step_order: order, day_delay: 1, subject: "Hi", body: "Hello", created_at: "", updated_at: "" };
}

// Excludes runSendWorker's run-level degraded check, which is unchanged by
// M3 and fires on any run that is mostly failures or has a needs_review lead.
function alerts(): { message: string; context?: Record<string, unknown> }[] {
  return captureError.mock.calls.map(([input]) => input).filter((input) => !input.message.startsWith("Degraded send run"));
}

beforeEach(() => {
  // Reset, not just clear: several tests make a mock reject, and that
  // implementation must not leak into the next test.
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-unsubscribe-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");

  db.claimDueSends.mockResolvedValue([claimedLead("cl-1", "lead-1", "mailbox-1")]);
  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: ALWAYS_OPEN });
  db.getLeadById.mockImplementation(async (_supabase: Client, id: string) => ({
    id,
    email: `${id}@example.test`,
    first_name: "Ada",
    last_name: null,
    company: null,
    title: null,
    custom_fields: null,
  }));
  db.getMailboxCredentials.mockImplementation(async (_supabase: Client, id: string) => ({ id, email: `${id}@sender.test`, display_name: null }));
  db.listSequences.mockResolvedValue([{ id: "seq-1" }]);
  db.listSequenceSteps.mockResolvedValue([step("step-1", 0), step("step-2", 1)]);
  db.getSuppression.mockResolvedValue(null);
  db.claimSendAttempt.mockImplementation(async (_supabase: Client, campaignLeadId: string) => ({ id: `attempt-${campaignLeadId}`, attempt_count: 1 }));
  db.getSettings.mockResolvedValue({ tracking_enabled: false, unsubscribe_text: null });
  db.listAttachmentsForStepScoped.mockResolvedValue([]);
  db.confirmSendAttemptEligible.mockResolvedValue("ok");
  db.updateClaimedCampaignLead.mockResolvedValue(true);
  send.mockResolvedValue({ providerMessageId: "<provider-msg@test>" });
});

describe("send worker — one lead's unexpected error is isolated", () => {
  it("completes the run, sends the other lead normally, and alerts once with the real error", async () => {
    db.claimDueSends.mockResolvedValue([claimedLead("cl-1", "lead-1", "mailbox-1"), claimedLead("cl-2", "lead-2", "mailbox-2")]);
    db.getLeadById.mockImplementation(async (_supabase: Client, id: string) => {
      if (id === "lead-1") throw DB_ERROR;
      return { id, email: `${id}@example.test`, first_name: null, last_name: null, company: null, title: null, custom_fields: null };
    });

    const summary = await runSendWorker(supabase, 25, 5);

    expect(summary).toEqual({ claimed: 2, sent: 1, failed: 1, needsReview: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to.email).toBe("lead-2@example.test");
    expect(db.recordSendSuccess).toHaveBeenCalledTimes(1);
    expect(db.recordSendSuccess).toHaveBeenCalledWith(supabase, expect.objectContaining({ campaignLeadId: "cl-2", sendAttemptId: "attempt-cl-2" }));

    // The throwing lead is left exactly as claimed: no attempt, no state change.
    expect(db.claimSendAttempt).not.toHaveBeenCalledWith(supabase, "cl-1", expect.anything());
    expect(db.recordSendFailure).not.toHaveBeenCalled();
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
    expect(db.updateClaimedCampaignLead).not.toHaveBeenCalled();
    expect(db.markMailboxErrored).not.toHaveBeenCalled();

    expect(alerts()).toEqual([
      expect.objectContaining({
        message: "Unexpected error processing a lead — left for retry after its lease expires: canceling statement due to statement timeout",
        context: { campaignLeadId: "cl-1", mailboxId: "mailbox-1" },
      }),
    ]);
  });

  it("isolates a throw from recordSendFailure too, without touching the mailbox", async () => {
    send.mockRejectedValue(new Error("socket hang up"));
    db.recordSendFailure.mockRejectedValue(DB_ERROR);

    const summary = await runSendWorker(supabase, 25, 1);

    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].message).toContain("canceling statement due to statement timeout");
  });
});

describe("send worker — nothing records a failure once the provider accepted the email", () => {
  it("flags needs_review instead of recording a failure when recordSendSuccess throws", async () => {
    db.recordSendSuccess.mockRejectedValue(DB_ERROR);

    const summary = await runSendWorker(supabase, 25, 1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(db.recordSendFailure).not.toHaveBeenCalled();
    // The only lead write: needs_review, guarded to the step that was sent.
    expect(db.updateClaimedCampaignLead).toHaveBeenCalledTimes(1);
    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      { status: "needs_review", last_error: "Sent, but the send couldn't be recorded. Check before resending.", locked_until: null },
      "step-1",
    );
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 0, needsReview: 1, skipped: 0 });
    expect(alerts()).toEqual([
      expect.objectContaining({
        message: "Email sent but recording it failed — lead needs review and will not be resent: canceling statement due to statement timeout",
        context: expect.objectContaining({ campaignLeadId: "cl-1", sendAttemptId: "attempt-cl-1", providerMessageId: "<provider-msg@test>" }),
      }),
    ]);
  });

  it("still never records a failure or resends when flagging for review also fails", async () => {
    db.recordSendSuccess.mockRejectedValue(DB_ERROR);
    db.updateClaimedCampaignLead.mockRejectedValue(DB_ERROR);

    const summary = await runSendWorker(supabase, 25, 1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(db.recordSendFailure).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, needsReview: 1, failed: 0 });
  });

  it("the attempt left pending is refused on the next claim and reaches needs_review without a second send", async () => {
    db.recordSendSuccess.mockRejectedValue(DB_ERROR);
    db.updateClaimedCampaignLead.mockRejectedValue(DB_ERROR);
    await runSendWorker(supabase, 25, 1);
    expect(send).toHaveBeenCalledTimes(1);

    // Next run, after the lease expired: claim_send_attempt refuses the
    // still-pending attempt, exactly as the database does.
    vi.clearAllMocks();
    db.claimDueSends.mockResolvedValue([claimedLead("cl-1", "lead-1", "mailbox-1")]);
    db.claimSendAttempt.mockResolvedValue(null);
    db.getSendAttempt.mockResolvedValue({ id: "attempt-cl-1", status: "pending" });
    db.updateClaimedCampaignLead.mockResolvedValue(true);

    const summary = await runSendWorker(supabase, 25, 1);

    expect(send).not.toHaveBeenCalled();
    expect(db.recordSendFailure).not.toHaveBeenCalled();
    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", { status: "needs_review", locked_until: null }, "step-1");
    expect(summary).toMatchObject({ needsReview: 1, sent: 0 });
  });

  it("a normal successful send is unchanged", async () => {
    const summary = await runSendWorker(supabase, 25, 1);

    expect(db.recordSendSuccess).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ sendAttemptId: "attempt-cl-1", campaignLeadId: "cl-1", nextStatus: "active", nextStepId: "step-2" }),
    );
    expect(db.updateClaimedCampaignLead).not.toHaveBeenCalled();
    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0, needsReview: 0, skipped: 0 });
    expect(alerts()).toEqual([]);
  });
});

describe("send worker — message preparation happens before the idempotency claim", () => {
  it("a settings read failure leaves no pending attempt behind", async () => {
    db.getSettings.mockRejectedValue(DB_ERROR);

    const summary = await runSendWorker(supabase, 25, 1);

    expect(db.claimSendAttempt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(db.recordSendFailure).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    expect(alerts()[0].message).toContain("canceling statement due to statement timeout");
  });

  it("missing unsubscribe-link config leaves no pending attempt behind", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    await runSendWorker(supabase, 25, 1);

    expect(db.claimSendAttempt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(alerts()[0].message).toContain("NEXT_PUBLIC_APP_URL is not set");
  });

  it("reads settings and builds the message before claiming, and claims before sending", async () => {
    await runSendWorker(supabase, 25, 1);

    const settingsOrder = db.getSettings.mock.invocationCallOrder[0];
    const claimOrder = db.claimSendAttempt.mock.invocationCallOrder[0];
    const sendOrder = send.mock.invocationCallOrder[0];
    expect(settingsOrder).toBeLessThan(claimOrder);
    expect(claimOrder).toBeLessThan(sendOrder);
    expect(send.mock.calls[0][0].text).toContain("https://app.test/");
  });
});
