import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import type { DeliveryReport } from "./delivery-report";
import type { ReplyMessage } from "./reply-provider";

// Asynchronous bounces (delivery status notifications) arriving through
// reply sync. Every function reply-worker.ts imports from "@/lib/db" must be
// present here (vi.mock replaces the whole module), same convention as
// lib/email/reply-worker.test.ts.
const db = vi.hoisted(() => ({
  claimMailboxesForReplySync: vi.fn(),
  createSuppression: vi.fn(),
  getCampaignLeadByCampaignAndLead: vi.fn(),
  getEmailEventByProviderMessageId: vi.fn(),
  getEmailReplyByEventId: vi.fn(),
  getLeadById: vi.fn(),
  getSentEventForOwner: vi.fn(),
  listActiveCampaignLeadsForMailbox: vi.fn(),
  listLeadIdsByEmail: vi.fn(),
  markCampaignLeadBounced: vi.fn(),
  recordEmailEvent: vi.fn(),
  recordEmailReply: vi.fn(),
  releaseMailboxReplySyncLock: vi.fn(),
  updateCampaignLead: vi.fn(),
  updateLead: vi.fn(),
  updateMailboxSyncCursor: vi.fn(),
}));
const { getReplyProviderMock, captureErrorMock } = vi.hoisted(() => ({
  getReplyProviderMock: vi.fn(),
  captureErrorMock: vi.fn(),
}));

vi.mock("@/lib/db", () => db);
vi.mock("./get-reply-provider", () => ({ getReplyProvider: getReplyProviderMock }));
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError: captureErrorMock }));

import { runReplySyncWorker } from "./reply-worker";

const supabaseStub = {} as unknown as Client;

function makeMailbox(overrides: Partial<Tables<"mailboxes">> = {}) {
  return { id: "mailbox-1", user_id: "user-1", email: "sales@example.com", ...overrides } as Tables<"mailboxes">;
}

function makeLead(overrides: Partial<Tables<"leads">> = {}) {
  return { id: "lead-1", user_id: "user-1", email: "dead@prospect.test", status: "contacted", ...overrides } as Tables<"leads">;
}

function makeSentEvent(overrides: Partial<Tables<"email_events">> = {}) {
  return {
    id: "sent-event-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    event_type: "sent",
    provider_message_id: "sent-1@example.com",
    metadata: {},
    created_at: "2026-09-30T10:00:00.000Z",
    updated_at: "2026-09-30T10:00:00.000Z",
    ...overrides,
  } as Tables<"email_events">;
}

function makeReport(overrides: Partial<DeliveryReport> = {}): DeliveryReport {
  return { hardBouncedRecipients: ["dead@prospect.test"], originalMessageId: "sent-1@example.com", ...overrides };
}

function makeBounceNotice(overrides: Partial<ReplyMessage> = {}): ReplyMessage {
  return {
    messageId: "ndr-1@mx.google.com",
    inReplyTo: null,
    references: [],
    from: { name: "Mail Delivery Subsystem", email: "mailer-daemon@googlemail.com" },
    to: [{ email: "sales@example.com" }],
    subject: "Delivery Status Notification (Failure)",
    bodyText: "Address not found.",
    bodyHtml: null,
    receivedAt: "2026-10-01T05:00:00.000Z",
    uid: 7,
    deliveryReport: makeReport(),
    ...overrides,
  };
}

function inbox(messages: ReplyMessage[]) {
  getReplyProviderMock.mockReturnValue({
    fetchNewMessages: vi.fn().mockResolvedValue({ messages, cursor: { uidValidity: 100, lastUid: 9 } }),
  });
}

// Nothing on the reply path may run for a bounce notice.
function expectNoReplyRecorded() {
  expect(db.recordEmailReply).not.toHaveBeenCalled();
  expect(db.updateLead).not.toHaveBeenCalled();
  expect(db.updateCampaignLead).not.toHaveBeenCalled();
  expect(db.recordEmailEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: "replied" }));
}

function expectNoBounceApplied() {
  expect(db.createSuppression).not.toHaveBeenCalled();
  expect(db.markCampaignLeadBounced).not.toHaveBeenCalled();
  expect(db.recordEmailEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  db.claimMailboxesForReplySync.mockResolvedValue([makeMailbox()]);
  db.updateMailboxSyncCursor.mockResolvedValue(undefined);
  db.releaseMailboxReplySyncLock.mockResolvedValue(undefined);
  db.getEmailEventByProviderMessageId.mockResolvedValue(null);
  db.getLeadById.mockResolvedValue(makeLead());
  db.getCampaignLeadByCampaignAndLead.mockResolvedValue({ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" });
  db.createSuppression.mockResolvedValue(undefined);
  db.markCampaignLeadBounced.mockResolvedValue(true);
  db.recordEmailEvent.mockResolvedValue({ id: "bounce-event-1" });
  db.recordEmailReply.mockResolvedValue({ id: "persisted-reply-1" });
  db.getEmailReplyByEventId.mockResolvedValue(null);
  // Mirrors the database's owner filter: sent-1 belongs to user-1, sent from mailbox-1.
  db.getSentEventForOwner.mockImplementation(async (_s: Client, id: string, userId: string) =>
    id === "sent-1@example.com" && userId === "user-1" ? makeSentEvent() : null,
  );
});

describe("reply sync — a mapped hard bounce", () => {
  it("suppresses the address, marks the enrollment bounced and records one bounce event, never a reply", async () => {
    inbox([makeBounceNotice()]);

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toEqual({ mailboxesChecked: 1, messagesFetched: 1, matched: 0, unmatched: 0, alreadyRecorded: 0, bounced: 1, failed: 0 });
    // The exact (user_id, email) pair the send worker's suppression re-check
    // looks up — getSuppression(campaign.user_id, lead.email) — so every
    // future send to this address, in any campaign, is blocked.
    expect(db.createSuppression).toHaveBeenCalledWith(supabaseStub, {
      user_id: "user-1",
      email: "dead@prospect.test",
      reason: "bounced",
      source_campaign_id: "campaign-1",
    });
    expect(db.markCampaignLeadBounced).toHaveBeenCalledWith(supabaseStub, "campaign-lead-1");
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
    expect(db.recordEmailEvent).toHaveBeenCalledWith(supabaseStub, {
      campaign_id: "campaign-1",
      lead_id: "lead-1",
      mailbox_id: "mailbox-1",
      event_type: "bounced",
      provider_message_id: "ndr-1@mx.google.com",
      metadata: { source: "delivery-report", bouncedMessageId: "sent-1@example.com" },
    });
    expectNoReplyRecorded();
    expect(db.updateMailboxSyncCursor).toHaveBeenCalledWith(supabaseStub, "mailbox-1", { uidValidity: 100, lastUid: 9 });
  });

  it("writes the event last, after the suppression and the enrollment", async () => {
    inbox([makeBounceNotice()]);

    await runReplySyncWorker(supabaseStub);

    const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];
    expect(order(db.createSuppression)).toBeLessThan(order(db.markCampaignLeadBounced));
    expect(order(db.markCampaignLeadBounced)).toBeLessThan(order(db.recordEmailEvent));
  });

  it("falls back to the notice's In-Reply-To when the original message wasn't returned", async () => {
    inbox([makeBounceNotice({ deliveryReport: makeReport({ originalMessageId: null }), inReplyTo: "sent-1@example.com" })]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 1 });
    expect(db.createSuppression).toHaveBeenCalledTimes(1);
  });

  it("falls back to the newest References entry when there is no In-Reply-To either", async () => {
    inbox([
      makeBounceNotice({
        deliveryReport: makeReport({ originalMessageId: null }),
        references: ["unknown-0@example.com", "sent-1@example.com"],
      }),
    ]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 1 });
    expect(db.getSentEventForOwner.mock.calls.map((call) => call[1])).toEqual(["sent-1@example.com"]);
  });

  it("matches a lead address stored with different case", async () => {
    db.getLeadById.mockResolvedValue(makeLead({ email: "Dead@Prospect.test" }));
    inbox([makeBounceNotice()]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 1 });
    // Suppressed exactly as stored, matching the send worker's lookup.
    expect(db.createSuppression).toHaveBeenCalledWith(supabaseStub, expect.objectContaining({ email: "Dead@Prospect.test" }));
  });

  it("still suppresses and records the bounce when the enrollment is in a state it doesn't overwrite", async () => {
    db.markCampaignLeadBounced.mockResolvedValue(false);
    inbox([makeBounceNotice()]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 1 });
    expect(db.createSuppression).toHaveBeenCalledTimes(1);
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
  });

  it("still suppresses and records the bounce when the enrollment no longer exists", async () => {
    db.getCampaignLeadByCampaignAndLead.mockResolvedValue(null);
    inbox([makeBounceNotice()]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 1 });
    expect(db.markCampaignLeadBounced).not.toHaveBeenCalled();
    expect(db.createSuppression).toHaveBeenCalledTimes(1);
  });
});

describe("reply sync — the same bounce notice twice", () => {
  it("changes nothing the second time once its bounce event exists", async () => {
    db.getEmailEventByProviderMessageId.mockImplementation(async (_s: Client, id: string, type: string) =>
      id === "ndr-1@mx.google.com" && type === "bounced" ? { id: "bounce-event-1" } : null,
    );
    inbox([makeBounceNotice()]);

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toMatchObject({ alreadyRecorded: 1, bounced: 0, failed: 0 });
    expectNoBounceApplied();
    expectNoReplyRecorded();
  });

  it("re-applies only idempotent writes when a previous run stopped before recording the event", async () => {
    // First run: the event insert fails after the suppression and enrollment writes.
    db.recordEmailEvent.mockRejectedValueOnce(new Error("connection reset"));
    inbox([makeBounceNotice()]);
    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 0, failed: 1 });
    // The cursor stops just before the notice, so the next sync retries it.
    expect(db.updateMailboxSyncCursor).toHaveBeenCalledWith(supabaseStub, "mailbox-1", { uidValidity: 100, lastUid: 6 });

    // Second run: suppression (unique per user/email, duplicates ignored) and
    // the guarded enrollment update are repeated; the event is written once.
    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ bounced: 1, failed: 0 });
    expect(db.createSuppression).toHaveBeenCalledTimes(2);
    expect(db.markCampaignLeadBounced).toHaveBeenCalledTimes(2);
    // Two insert attempts, of which only the second succeeded.
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(2);
    await expect(db.recordEmailEvent.mock.results[0].value).rejects.toThrow("connection reset");
    await expect(db.recordEmailEvent.mock.results[1].value).resolves.toEqual({ id: "bounce-event-1" });
  });
});

describe("reply sync — bounce notices that can't be mapped are never guessed", () => {
  it("does nothing when the bounced address isn't the lead's address", async () => {
    inbox([makeBounceNotice({ deliveryReport: makeReport({ hardBouncedRecipients: ["someone-else@prospect.test"] }) })]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ unmatched: 1, bounced: 0, failed: 0 });
    expectNoBounceApplied();
    expectNoReplyRecorded();
  });

  it("does nothing when the bounced message is not one of this owner's sends", async () => {
    inbox([makeBounceNotice({ deliveryReport: makeReport({ originalMessageId: "unknown@example.com" }) })]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ unmatched: 1, bounced: 0 });
    expectNoBounceApplied();
    expect(db.getLeadById).not.toHaveBeenCalled();
  });

  it("does nothing when the bounced message was sent from a different mailbox", async () => {
    db.getSentEventForOwner.mockResolvedValue(makeSentEvent({ mailbox_id: "mailbox-2" }));
    inbox([makeBounceNotice()]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ unmatched: 1, bounced: 0 });
    expectNoBounceApplied();
  });

  it("does nothing for a notice with no hard-bounced recipient (a delay or policy notice), and isn't a reply", async () => {
    inbox([makeBounceNotice({ deliveryReport: makeReport({ hardBouncedRecipients: [] }), inReplyTo: "sent-1@example.com" })]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ unmatched: 1, matched: 0, bounced: 0 });
    expectNoBounceApplied();
    expectNoReplyRecorded();
    expect(db.getSentEventForOwner).not.toHaveBeenCalled();
  });

  it("never records a mail-system message as a reply, even when its In-Reply-To matches a send", async () => {
    // A non-RFC 3464 bounce from MAILER-DAEMON: before this change, the
    // header match would have recorded it as the lead replying.
    inbox([makeBounceNotice({ deliveryReport: null, from: { email: "MAILER-DAEMON@mx.prospect.test" }, inReplyTo: "sent-1@example.com" })]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ unmatched: 1, matched: 0, bounced: 0 });
    expectNoBounceApplied();
    expectNoReplyRecorded();
  });

  it("logs an unmapped notice with ids and the reason only — never the address or content", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    inbox([makeBounceNotice({ deliveryReport: makeReport({ originalMessageId: "unknown@example.com" }) })]);

    await runReplySyncWorker(supabaseStub);

    expect(log).toHaveBeenCalledWith("[reply-worker] bounce notice not applied", {
      mailboxId: "mailbox-1",
      messageId: "ndr-1@mx.google.com",
      reason: "bounced message is not one this mailbox sent",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("dead@prospect.test");
    expect(captureErrorMock).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("reply sync — normal replies are unchanged alongside bounces", () => {
  it("still records a human reply (no delivery report) through the reply path", async () => {
    db.getLeadById.mockResolvedValue(makeLead({ email: "lead@prospect.test" }));
    db.recordEmailEvent.mockResolvedValue({ id: "reply-event-1", campaign_id: "campaign-1", lead_id: "lead-1", mailbox_id: "mailbox-1" });
    inbox([
      makeBounceNotice({
        messageId: "reply-1@prospect.test",
        from: { email: "lead@prospect.test" },
        inReplyTo: "sent-1@example.com",
        deliveryReport: null,
      }),
    ]);

    expect(await runReplySyncWorker(supabaseStub)).toMatchObject({ matched: 1, bounced: 0 });
    expect(db.recordEmailEvent).toHaveBeenCalledWith(supabaseStub, expect.objectContaining({ event_type: "replied" }));
    expect(db.updateCampaignLead).toHaveBeenCalledWith(supabaseStub, "campaign-lead-1", {
      status: "replied",
      current_step_id: null,
      next_send_at: null,
    });
    expect(db.createSuppression).not.toHaveBeenCalled();
    expect(db.markCampaignLeadBounced).not.toHaveBeenCalled();
  });

  it("keeps mailboxes isolated: one mailbox's failing bounce never stops another's", async () => {
    db.claimMailboxesForReplySync.mockResolvedValue([
      makeMailbox({ id: "mailbox-1" }),
      makeMailbox({ id: "mailbox-2", user_id: "user-2" }),
    ]);
    db.createSuppression.mockRejectedValueOnce(new Error("connection reset"));
    db.getSentEventForOwner.mockImplementation(async (_s: Client, id: string, userId: string) => {
      if (id === "sent-1@example.com" && userId === "user-1") return makeSentEvent();
      if (id === "sent-9@example.com" && userId === "user-2") return makeSentEvent({ mailbox_id: "mailbox-2", lead_id: "lead-9", campaign_id: "campaign-9" });
      return null;
    });
    db.getLeadById.mockImplementation(async (_s: Client, id: string) =>
      id === "lead-9" ? makeLead({ id: "lead-9", user_id: "user-2", email: "gone@other.test" }) : makeLead(),
    );
    getReplyProviderMock.mockImplementation((mailbox: Tables<"mailboxes">) => ({
      fetchNewMessages: vi.fn().mockResolvedValue({
        messages:
          mailbox.id === "mailbox-1"
            ? [makeBounceNotice()]
            : [
                makeBounceNotice({
                  messageId: "ndr-9@other.test",
                  deliveryReport: makeReport({ hardBouncedRecipients: ["gone@other.test"], originalMessageId: "sent-9@example.com" }),
                }),
              ],
        cursor: { uidValidity: 100, lastUid: 9 },
      }),
    }));

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toMatchObject({ mailboxesChecked: 2, bounced: 1, failed: 1 });
    // Mailbox 2's bounce is applied to its own owner only.
    expect(db.createSuppression).toHaveBeenLastCalledWith(supabaseStub, {
      user_id: "user-2",
      email: "gone@other.test",
      reason: "bounced",
      source_campaign_id: "campaign-9",
    });
    expect(db.updateMailboxSyncCursor).toHaveBeenCalledWith(supabaseStub, "mailbox-1", { uidValidity: 100, lastUid: 6 });
    expect(db.updateMailboxSyncCursor).toHaveBeenCalledWith(supabaseStub, "mailbox-2", { uidValidity: 100, lastUid: 9 });
  });
});
