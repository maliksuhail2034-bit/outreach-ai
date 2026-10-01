import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import { EmailSendError } from "./provider";
import { classifySmtpError } from "./providers/smtp";

// H2: a mailbox-level send failure (EmailSendError.mailboxIssue) moves the
// mailbox to 'error' once and keeps the triggering lead retryable; every
// other failure leaves the mailbox alone. Drives the real runSendWorker ->
// processCampaignLead path with the database layer and provider mocked, same
// harness as send-worker-status-race.test.ts. markMailboxErrored's own
// status guard is covered in lib/db/mailboxes.test.ts.

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

const MAILBOX_ISSUE = new EmailSendError("Invalid login: 535 5.7.8 Username and Password not accepted.", "failed", true);

async function runOnce() {
  db.claimDueSends.mockResolvedValue([claimedLead()]);
  return runSendWorker(supabase, 1, 1);
}

// runSendWorker's run-level degraded check (reportDegradedSendRun) also
// alerts when more than half of a run failed, which a one-lead run that
// fails always trips. It's unchanged by H2, so it's excluded here to count
// only the per-lead and mailbox alerts.
function sendAlerts(): { message: string; job: string; context: Record<string, unknown> }[] {
  return captureError.mock.calls
    .map(([input]) => input)
    .filter((input) => !input.message.startsWith("Degraded send run"));
}

function recordedFailure() {
  expect(db.recordSendFailure).toHaveBeenCalledTimes(1);
  return db.recordSendFailure.mock.calls[0][1];
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
  db.confirmSendAttemptEligible.mockResolvedValue("ok");
  db.markMailboxErrored.mockResolvedValue(true);
});

describe("send worker — mailbox-level failure", () => {
  it("moves the active mailbox to error, keeps the lead retryable, and alerts exactly once", async () => {
    send.mockRejectedValue(MAILBOX_ISSUE);

    const summary = await runOnce();

    expect(db.markMailboxErrored).toHaveBeenCalledTimes(1);
    expect(db.markMailboxErrored).toHaveBeenCalledWith(supabase, "mailbox-1");
    const failure = recordedFailure();
    expect(failure).toMatchObject({ sendAttemptId: "attempt-1", campaignLeadId: "cl-1", outcome: "retry" });
    expect(new Date(failure.nextSendAt).getTime()).toBeGreaterThan(Date.now());
    expect(sendAlerts()).toHaveLength(1);
    expect(sendAlerts()[0]).toEqual(
      expect.objectContaining({ job: "send-emails", context: expect.objectContaining({ mailboxId: "mailbox-1" }) }),
    );
    expect(sendAlerts()[0].message).toMatch(/^Mailbox moved to error/);
    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
  });

  it("leaves the existing run-level degraded alert unchanged", async () => {
    send.mockRejectedValue(MAILBOX_ISSUE);

    await runOnce();

    const degraded = captureError.mock.calls.map(([input]) => input.message).filter((m) => m.startsWith("Degraded send run"));
    expect(degraded).toEqual(["Degraded send run: high failure rate: 1/1 sends failed"]);
  });

  it("records the lead before touching the mailbox", async () => {
    send.mockRejectedValue(MAILBOX_ISSUE);

    await runOnce();

    expect(db.recordSendFailure.mock.invocationCallOrder[0]).toBeLessThan(db.markMailboxErrored.mock.invocationCallOrder[0]);
  });

  it("sends no alert and changes nothing further when the mailbox is no longer active", async () => {
    send.mockRejectedValue(MAILBOX_ISSUE);
    db.markMailboxErrored.mockResolvedValue(false);

    await runOnce();

    expect(db.markMailboxErrored).toHaveBeenCalledTimes(1);
    expect(recordedFailure()).toMatchObject({ outcome: "retry" });
    expect(sendAlerts()).toEqual([]);
    expect(db.updateCampaignLead).not.toHaveBeenCalled();
  });

  it("still fails the lead terminally once the retry cap is reached", async () => {
    send.mockRejectedValue(MAILBOX_ISSUE);
    db.claimSendAttempt.mockResolvedValue({ id: "attempt-1", attempt_count: 5 });

    await runOnce();

    const failure = recordedFailure();
    expect(failure).toMatchObject({ outcome: "failed" });
    expect(failure.nextSendAt).toBeUndefined();
    expect(db.markMailboxErrored).toHaveBeenCalledTimes(1);
    // One alert for the mailbox incident, not a second per-lead one.
    expect(sendAlerts()).toHaveLength(1);
    expect(sendAlerts()[0].message).toMatch(/^Mailbox moved to error/);
  });

  it("keeps the lead retryable and reports it when the mailbox update itself fails", async () => {
    send.mockRejectedValue(MAILBOX_ISSUE);
    db.markMailboxErrored.mockRejectedValue(new Error("connection reset"));

    const summary = await runOnce();

    expect(recordedFailure()).toMatchObject({ outcome: "retry" });
    expect(sendAlerts()).toHaveLength(1);
    expect(sendAlerts()[0].message).toMatch(/^Could not move mailbox to error/);
    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
  });
});

describe("send worker — failures that must not touch the mailbox", () => {
  it("a recipient bounce stays bounced and leaves the mailbox alone", async () => {
    send.mockRejectedValue(new EmailSendError("Recipient command failed: 550 5.1.1 User unknown", "bounced"));

    await runOnce();

    expect(recordedFailure()).toMatchObject({ outcome: "bounced" });
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
    expect(sendAlerts()).toEqual([]);
  });

  it("a lead-level failure stays failed, alerts per lead as before, and leaves the mailbox alone", async () => {
    send.mockRejectedValue(new EmailSendError("Message failed: 554 5.7.1 Message rejected due to spam policy", "failed"));

    await runOnce();

    expect(recordedFailure()).toMatchObject({ outcome: "failed" });
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
    expect(sendAlerts()).toHaveLength(1);
    expect(sendAlerts()[0].message).toBe("Message failed: 554 5.7.1 Message rejected due to spam policy");
  });

  it("a transient failure keeps the existing retry behavior and leaves the mailbox alone", async () => {
    send.mockRejectedValue(new EmailSendError("Connection timeout", "retry"));

    await runOnce();

    const failure = recordedFailure();
    expect(failure).toMatchObject({ outcome: "retry" });
    expect(failure.nextSendAt).toEqual(expect.any(String));
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
    expect(sendAlerts()).toEqual([]);
  });

  it("an unexpected non-EmailSendError throw leaves the mailbox alone", async () => {
    send.mockRejectedValue(new TypeError("Cannot read properties of undefined"));

    await runOnce();

    expect(recordedFailure()).toMatchObject({ outcome: "retry", errorMessage: "Unknown send error." });
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
  });

  it("a successful send never touches the mailbox", async () => {
    send.mockResolvedValue({ providerMessageId: "provider-msg-1" });

    await runOnce();

    expect(db.recordSendSuccess).toHaveBeenCalledTimes(1);
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
  });
});

// P.2: sender-level 5xx after MAIL FROM, through the real classifier. Before,
// these were lead-level: each run failed one more lead from the same broken
// mailbox while the mailbox stayed active and claimable.
describe("send worker — sender-level rejection from the real SMTP classifier", () => {
  function smtpRejection(command: string, response: string) {
    return classifySmtpError(
      Object.assign(new Error(`Message failed: ${response}`), {
        code: command === "DATA" ? "EMESSAGE" : "EENVELOPE",
        responseCode: Number(response.slice(0, 3)),
        command,
        response,
      }),
    );
  }

  it.each([
    ["DATA", "550-5.7.26 Unauthenticated email from example.test is not accepted due to domain's DMARC policy."],
    ["DATA", "554 5.2.252 SendAsDenied; sender@example.test not allowed to send as other@example.test"],
    ["DATA", "554 5.2.0 STOREDRV.Submission.Exception:OutboundSpamException"],
    ["RCPT TO", "554 5.7.1 <lead@example.test>: Relay access denied"],
  ])("%s %s → mailbox to error, lead kept retryable (not failed), one mailbox alert", async (command, response) => {
    send.mockRejectedValue(smtpRejection(command, response));

    await runOnce();

    expect(db.markMailboxErrored).toHaveBeenCalledTimes(1);
    expect(db.markMailboxErrored).toHaveBeenCalledWith(supabase, "mailbox-1");
    const failure = recordedFailure();
    expect(failure).toMatchObject({ sendAttemptId: "attempt-1", campaignLeadId: "cl-1", outcome: "retry" });
    expect(new Date(failure.nextSendAt).getTime()).toBeGreaterThan(Date.now());
    // Only the mailbox alert — no per-lead "failed" alert.
    expect(sendAlerts()).toHaveLength(1);
    expect(sendAlerts()[0].message).toBe(`Mailbox moved to error — sending stopped until it is fixed: Message failed: ${response}`);
    expect(sendAlerts()[0].context).toMatchObject({ mailboxId: "mailbox-1", campaignLeadId: "cl-1" });
  });

  it("repeated rejections don't storm: only the run that moves the mailbox to error alerts", async () => {
    send.mockRejectedValue(smtpRejection("DATA", "550 5.7.26 This mail is unauthenticated (DMARC)"));

    await runOnce();
    // A later run that reached the same mailbox (e.g. one already in flight
    // when it errored) finds it no longer active: no transition, no alert.
    db.markMailboxErrored.mockResolvedValue(false);
    await runOnce();

    expect(db.markMailboxErrored).toHaveBeenCalledTimes(2);
    expect(sendAlerts()).toHaveLength(1);
    expect(db.recordSendFailure.mock.calls.map(([, params]) => params.outcome)).toEqual(["retry", "retry"]);
  });

  it("a recipient bounce from the real classifier still bounces and leaves the mailbox alone", async () => {
    send.mockRejectedValue(smtpRejection("RCPT TO", "550 5.1.1 The email account that you tried to reach does not exist."));

    await runOnce();

    expect(recordedFailure()).toMatchObject({ outcome: "bounced" });
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
  });

  it("an ambiguous policy rejection stays lead-level, as before", async () => {
    send.mockRejectedValue(smtpRejection("RCPT TO", "554 5.7.1 Message rejected due to spam policy"));

    await runOnce();

    expect(recordedFailure()).toMatchObject({ outcome: "failed" });
    expect(db.markMailboxErrored).not.toHaveBeenCalled();
  });
});
