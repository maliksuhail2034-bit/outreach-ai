import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import type { ReplyMessage } from "./reply-provider";

// Batch: reply content persistence. Every function reply-worker.ts imports
// from "@/lib/db" must be present here (vi.mock replaces the whole module),
// same convention as lib/warmup/warmup-worker.test.ts.
const {
  claimMailboxesForReplySyncMock,
  getCampaignLeadByCampaignAndLeadMock,
  getEmailEventByProviderMessageIdMock,
  getEmailReplyByEventIdMock,
  getLeadByIdMock,
  listActiveCampaignLeadsForMailboxMock,
  listLeadIdsByEmailMock,
  recordEmailEventMock,
  recordEmailReplyMock,
  releaseMailboxReplySyncLockMock,
  updateCampaignLeadMock,
  updateLeadMock,
  updateMailboxSyncCursorMock,
  getReplyProviderMock,
  captureErrorMock,
} = vi.hoisted(() => ({
  claimMailboxesForReplySyncMock: vi.fn(),
  getCampaignLeadByCampaignAndLeadMock: vi.fn(),
  getEmailEventByProviderMessageIdMock: vi.fn(),
  getEmailReplyByEventIdMock: vi.fn(),
  getLeadByIdMock: vi.fn(),
  listActiveCampaignLeadsForMailboxMock: vi.fn(),
  listLeadIdsByEmailMock: vi.fn(),
  recordEmailEventMock: vi.fn(),
  recordEmailReplyMock: vi.fn(),
  releaseMailboxReplySyncLockMock: vi.fn(),
  updateCampaignLeadMock: vi.fn(),
  updateLeadMock: vi.fn(),
  updateMailboxSyncCursorMock: vi.fn(),
  getReplyProviderMock: vi.fn(),
  captureErrorMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  claimMailboxesForReplySync: claimMailboxesForReplySyncMock,
  getCampaignLeadByCampaignAndLead: getCampaignLeadByCampaignAndLeadMock,
  getEmailEventByProviderMessageId: getEmailEventByProviderMessageIdMock,
  getEmailReplyByEventId: getEmailReplyByEventIdMock,
  getLeadById: getLeadByIdMock,
  listActiveCampaignLeadsForMailbox: listActiveCampaignLeadsForMailboxMock,
  listLeadIdsByEmail: listLeadIdsByEmailMock,
  recordEmailEvent: recordEmailEventMock,
  recordEmailReply: recordEmailReplyMock,
  releaseMailboxReplySyncLock: releaseMailboxReplySyncLockMock,
  updateCampaignLead: updateCampaignLeadMock,
  updateLead: updateLeadMock,
  updateMailboxSyncCursor: updateMailboxSyncCursorMock,
}));

vi.mock("./get-reply-provider", () => ({
  getReplyProvider: getReplyProviderMock,
}));

vi.mock("@/lib/monitoring/error-tracking", () => ({
  captureError: captureErrorMock,
}));

import { runReplySyncWorker } from "./reply-worker";

const supabaseStub = {} as unknown as Client;

function makeMailbox(overrides: Partial<Tables<"mailboxes">> = {}): Tables<"mailboxes"> {
  return {
    id: "mailbox-1",
    user_id: "user-1",
    domain_id: null,
    email: "sales@example.com",
    display_name: null,
    email_provider: "smtp",
    smtp_host: "smtp.example.com",
    smtp_port: 587,
    smtp_username: "sales@example.com",
    encrypted_smtp_password: "cipher-smtp",
    encrypted_google_refresh_token: null,
    encrypted_microsoft_refresh_token: null,
    daily_limit: 100,
    hourly_limit: 20,
    cooldown_minutes: 5,
    warmup_enabled: false,
    status: "active",
    reply_provider: "imap",
    imap_enabled: true,
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_username: "sales@example.com",
    encrypted_imap_password: "cipher-imap",
    imap_uid_validity: 100,
    imap_last_uid: 0,
    reply_sync_locked_until: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeReplyMessage(overrides: Partial<ReplyMessage> = {}): ReplyMessage {
  return {
    messageId: "reply-1@example.com",
    inReplyTo: "sent-1@example.com",
    references: ["sent-1@example.com"],
    from: { name: "Lead Name", email: "lead@example.com" },
    to: [{ name: "Sales", email: "sales@example.com" }],
    subject: "Re: following up",
    bodyText: "Sounds good, let's talk.",
    bodyHtml: "<p>Sounds good, let's talk.</p>",
    receivedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

function makeEmailEvent(overrides: Partial<Tables<"email_events">> = {}): Tables<"email_events"> {
  return {
    id: "event-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    event_type: "replied",
    provider_message_id: "reply-1@example.com",
    metadata: {},
    created_at: "2026-09-20T10:00:01.000Z",
    updated_at: "2026-09-20T10:00:01.000Z",
    ...overrides,
  };
}

function makeLead(overrides: Partial<Tables<"leads">> = {}): Tables<"leads"> {
  return {
    id: "lead-1",
    user_id: "user-1",
    list_id: null,
    email: "lead@example.com",
    first_name: null,
    last_name: null,
    company: null,
    title: null,
    phone: null,
    linkedin: null,
    website: null,
    city: null,
    country: null,
    status: "contacted",
    custom_fields: {},
    verification_status: "unknown",
    verification_detail: null,
    verification_risk_score: null,
    verification_locked_until: null,
    verified_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fetchResultWith(messages: ReplyMessage[]) {
  return { messages, cursor: { uidValidity: 100, lastUid: 5 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  claimMailboxesForReplySyncMock.mockResolvedValue([makeMailbox()]);
  updateMailboxSyncCursorMock.mockResolvedValue(undefined);
  releaseMailboxReplySyncLockMock.mockResolvedValue(undefined);
  recordEmailReplyMock.mockResolvedValue({ id: "persisted-reply-1" });
  updateCampaignLeadMock.mockResolvedValue(undefined);
  updateLeadMock.mockResolvedValue(undefined);
  getLeadByIdMock.mockResolvedValue(makeLead());
  getEmailReplyByEventIdMock.mockResolvedValue(null);
});

describe("runReplySyncWorker — matched reply persists content", () => {
  it("persists subject/from/to/body/receivedAt alongside the matched email_events row", async () => {
    const message = makeReplyMessage();
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });

    // First call is the idempotency pre-check (by inbound messageId) — not
    // yet recorded. Second call is matchReply's header lookup (by
    // inReplyTo) — matches a prior 'sent' event.
    getEmailEventByProviderMessageIdMock.mockImplementation(
      async (_supabase: Client, id: string, eventType: string) => {
        if (eventType === "replied") return null;
        if (eventType === "sent" && id === "sent-1@example.com") {
          return makeEmailEvent({ id: "sent-event-1", event_type: "sent", provider_message_id: "sent-1@example.com" });
        }
        return null;
      },
    );
    getCampaignLeadByCampaignAndLeadMock.mockResolvedValue({ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" });
    const insertedEvent = makeEmailEvent();
    recordEmailEventMock.mockResolvedValue(insertedEvent);

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toEqual({ mailboxesChecked: 1, messagesFetched: 1, matched: 1, unmatched: 0, alreadyRecorded: 0 });
    expect(recordEmailReplyMock).toHaveBeenCalledTimes(1);
    expect(recordEmailReplyMock).toHaveBeenCalledWith(supabaseStub, {
      email_event_id: insertedEvent.id,
      campaign_id: insertedEvent.campaign_id,
      lead_id: insertedEvent.lead_id,
      mailbox_id: insertedEvent.mailbox_id,
      subject: "Re: following up",
      from_email: "lead@example.com",
      from_name: "Lead Name",
      to_emails: ["sales@example.com"],
      body_text: "Sounds good, let's talk.",
      body_html: "<p>Sounds good, let's talk.</p>",
      received_at: "2026-09-20T10:00:00.000Z",
    });
    // Existing behavior preserved: campaign_leads/leads status still flip.
    expect(updateCampaignLeadMock).toHaveBeenCalledWith(supabaseStub, "campaign-lead-1", {
      status: "replied",
      current_step_id: null,
      next_send_at: null,
    });
    expect(updateLeadMock).toHaveBeenCalledWith(supabaseStub, "user-1", "lead-1", { status: "replied" });
  });

  it("persists null body/subject/empty to-list without throwing when the message has none", async () => {
    const message = makeReplyMessage({ subject: null, bodyText: null, bodyHtml: null, to: [] });
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    getEmailEventByProviderMessageIdMock.mockImplementation(async (_s: Client, id: string, eventType: string) => {
      if (eventType === "replied") return null;
      if (eventType === "sent" && id === "sent-1@example.com") return makeEmailEvent({ id: "sent-event-1", event_type: "sent" });
      return null;
    });
    getCampaignLeadByCampaignAndLeadMock.mockResolvedValue({ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" });
    recordEmailEventMock.mockResolvedValue(makeEmailEvent());

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary.matched).toBe(1);
    expect(recordEmailReplyMock).toHaveBeenCalledWith(
      supabaseStub,
      expect.objectContaining({ subject: null, body_text: null, body_html: null, to_emails: [] }),
    );
  });
});

describe("runReplySyncWorker — duplicate inbound Message-ID", () => {
  it("does not call recordEmailEvent or duplicate the persisted reply when already recorded", async () => {
    const message = makeReplyMessage();
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    const existingEvent = makeEmailEvent();
    getEmailEventByProviderMessageIdMock.mockResolvedValue(existingEvent);
    getEmailReplyByEventIdMock.mockResolvedValue({ id: "persisted-reply-1" }); // already persisted

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toEqual({ mailboxesChecked: 1, messagesFetched: 1, matched: 0, unmatched: 0, alreadyRecorded: 1 });
    expect(recordEmailEventMock).not.toHaveBeenCalled();
    expect(recordEmailReplyMock).not.toHaveBeenCalled();
  });

  it("backfills the missing email_replies row exactly once when the event was recorded but content wasn't persisted", async () => {
    const message = makeReplyMessage();
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    const existingEvent = makeEmailEvent();
    getEmailEventByProviderMessageIdMock.mockResolvedValue(existingEvent);
    getEmailReplyByEventIdMock.mockResolvedValue(null); // never persisted (e.g. a prior crash)

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary.alreadyRecorded).toBe(1);
    expect(recordEmailEventMock).not.toHaveBeenCalled();
    expect(recordEmailReplyMock).toHaveBeenCalledTimes(1);
    expect(recordEmailReplyMock).toHaveBeenCalledWith(supabaseStub, expect.objectContaining({ email_event_id: existingEvent.id }));
  });

  it("on a concurrent-insert race (unique violation), backfills from the winning row without a second email_replies row", async () => {
    const message = makeReplyMessage();
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });

    getCampaignLeadByCampaignAndLeadMock.mockResolvedValue({ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" });
    const winningEvent = makeEmailEvent();

    let preCheckCalls = 0;
    getEmailEventByProviderMessageIdMock.mockImplementation(async (_s: Client, id: string, eventType: string) => {
      if (eventType === "sent" && id === "sent-1@example.com") return makeEmailEvent({ id: "sent-event-1", event_type: "sent" });
      if (eventType === "replied") {
        preCheckCalls += 1;
        // First call (pre-check): not yet visible. Second call (after the
        // unique violation below): the concurrent run's winning row.
        return preCheckCalls === 1 ? null : winningEvent;
      }
      return null;
    });

    const uniqueViolation = Object.assign(new Error("duplicate key value"), { code: "23505" });
    recordEmailEventMock.mockRejectedValue(uniqueViolation);
    getEmailReplyByEventIdMock.mockResolvedValue(null);

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toEqual({ mailboxesChecked: 1, messagesFetched: 1, matched: 0, unmatched: 0, alreadyRecorded: 1 });
    expect(recordEmailReplyMock).toHaveBeenCalledTimes(1);
    expect(recordEmailReplyMock).toHaveBeenCalledWith(supabaseStub, expect.objectContaining({ email_event_id: winningEvent.id }));
    // The losing side must never flip campaign_leads/leads itself — only
    // whichever run's insert actually won does that.
    expect(updateCampaignLeadMock).not.toHaveBeenCalled();
  });

  it("re-throws a non-unique-violation error from recordEmailEvent instead of treating it as a duplicate", async () => {
    const message = makeReplyMessage();
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    getEmailEventByProviderMessageIdMock.mockImplementation(async (_s: Client, id: string, eventType: string) => {
      if (eventType === "sent" && id === "sent-1@example.com") return makeEmailEvent({ id: "sent-event-1", event_type: "sent" });
      return null;
    });
    getCampaignLeadByCampaignAndLeadMock.mockResolvedValue({ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" });
    recordEmailEventMock.mockRejectedValue(new Error("connection reset"));

    await expect(runReplySyncWorker(supabaseStub)).rejects.toThrow("connection reset");
    expect(recordEmailReplyMock).not.toHaveBeenCalled();
  });
});

describe("runReplySyncWorker — existing matching behavior is unchanged", () => {
  it("prefers a header match (In-Reply-To) over the address fallback", async () => {
    const message = makeReplyMessage();
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    getEmailEventByProviderMessageIdMock.mockImplementation(async (_s: Client, id: string, eventType: string) => {
      if (eventType === "replied") return null;
      if (eventType === "sent" && id === "sent-1@example.com") return makeEmailEvent({ id: "sent-event-1", event_type: "sent" });
      return null;
    });
    getCampaignLeadByCampaignAndLeadMock.mockResolvedValue({ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" });
    recordEmailEventMock.mockResolvedValue(makeEmailEvent());

    await runReplySyncWorker(supabaseStub);

    // Header match found — the address-fallback lookups must never run.
    expect(listLeadIdsByEmailMock).not.toHaveBeenCalled();
    expect(listActiveCampaignLeadsForMailboxMock).not.toHaveBeenCalled();
  });

  it("falls back to a from-address match only when no header match exists, and only if unambiguous", async () => {
    const message = makeReplyMessage({ inReplyTo: null, references: [] });
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    getEmailEventByProviderMessageIdMock.mockResolvedValue(null);
    listLeadIdsByEmailMock.mockResolvedValue(["lead-1"]);
    listActiveCampaignLeadsForMailboxMock.mockResolvedValue([{ id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" }]);
    recordEmailEventMock.mockResolvedValue(makeEmailEvent());

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary.matched).toBe(1);
    expect(recordEmailEventMock).toHaveBeenCalledWith(
      supabaseStub,
      expect.objectContaining({ metadata: expect.objectContaining({ matchedVia: "address-fallback" }) }),
    );
  });

  it("never guesses: an ambiguous from-address match (2+ candidates) stays unmatched", async () => {
    const message = makeReplyMessage({ inReplyTo: null, references: [] });
    getReplyProviderMock.mockReturnValue({ fetchNewMessages: vi.fn().mockResolvedValue(fetchResultWith([message])) });
    getEmailEventByProviderMessageIdMock.mockResolvedValue(null);
    listLeadIdsByEmailMock.mockResolvedValue(["lead-1", "lead-2"]);
    listActiveCampaignLeadsForMailboxMock.mockResolvedValue([
      { id: "campaign-lead-1", campaign_id: "campaign-1", lead_id: "lead-1" },
      { id: "campaign-lead-2", campaign_id: "campaign-2", lead_id: "lead-2" },
    ]);

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary).toEqual({ mailboxesChecked: 1, messagesFetched: 1, matched: 0, unmatched: 1, alreadyRecorded: 0 });
    expect(recordEmailEventMock).not.toHaveBeenCalled();
    expect(recordEmailReplyMock).not.toHaveBeenCalled();
  });
});

describe("runReplySyncWorker — mailbox lease/error isolation preserved", () => {
  it("releases the lease and continues past a mailbox whose provider fetch throws", async () => {
    const failingMailbox = makeMailbox({ id: "mailbox-failing" });
    const okMailbox = makeMailbox({ id: "mailbox-ok" });
    claimMailboxesForReplySyncMock.mockResolvedValue([failingMailbox, okMailbox]);

    getReplyProviderMock.mockImplementation((mailbox: Tables<"mailboxes">) => ({
      fetchNewMessages:
        mailbox.id === "mailbox-failing"
          ? vi.fn().mockRejectedValue(new Error("IMAP auth failed"))
          : vi.fn().mockResolvedValue(fetchResultWith([])),
    }));

    const summary = await runReplySyncWorker(supabaseStub);

    expect(summary.mailboxesChecked).toBe(2);
    expect(releaseMailboxReplySyncLockMock).toHaveBeenCalledWith(supabaseStub, "mailbox-failing");
    expect(captureErrorMock).toHaveBeenCalledWith(expect.objectContaining({ job: "sync-replies" }));
    expect(updateMailboxSyncCursorMock).toHaveBeenCalledWith(supabaseStub, "mailbox-ok", expect.anything());
  });
});
