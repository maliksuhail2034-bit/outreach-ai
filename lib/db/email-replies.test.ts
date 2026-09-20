import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { getEmailReplyByEventId, recordEmailReply } from "./email-replies";

function createClient(result: { data?: unknown; error?: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "eq", "insert"] as const) {
    chain[method].mockReturnValue(chain);
  }
  chain.maybeSingle.mockResolvedValue(result);
  chain.single.mockResolvedValue(result);
  const from = vi.fn(() => chain);
  const client = { from } as unknown as Client;
  return { client, chain };
}

const replyRow = {
  id: "reply-1",
  email_event_id: "event-1",
  campaign_id: "campaign-1",
  lead_id: "lead-1",
  mailbox_id: "mailbox-1",
  subject: "Re: hello",
  from_email: "lead@example.com",
  from_name: "Lead Name",
  to_emails: ["mailbox@example.com"],
  body_text: "Sounds good",
  body_html: "<p>Sounds good</p>",
  received_at: "2026-09-20T10:00:00.000Z",
  created_at: "2026-09-20T10:00:01.000Z",
};

describe("getEmailReplyByEventId", () => {
  it("scopes the lookup to the given email_event_id", async () => {
    const { client, chain } = createClient({ data: replyRow, error: null });

    const result = await getEmailReplyByEventId(client, "event-1");

    expect(client.from).toHaveBeenCalledWith("email_replies");
    expect(chain.eq).toHaveBeenCalledWith("email_event_id", "event-1");
    expect(result).toEqual(replyRow);
  });

  it("returns null when no reply has been persisted for that event yet", async () => {
    const { client } = createClient({ data: null, error: null });
    expect(await getEmailReplyByEventId(client, "event-2")).toBeNull();
  });

  it("throws on a query error", async () => {
    const { client } = createClient({ data: null, error: new Error("boom") });
    await expect(getEmailReplyByEventId(client, "event-1")).rejects.toThrow("boom");
  });
});

describe("recordEmailReply", () => {
  it("inserts the given values and returns the inserted row", async () => {
    const { client, chain } = createClient({ data: replyRow, error: null });

    const values = {
      email_event_id: "event-1",
      campaign_id: "campaign-1",
      lead_id: "lead-1",
      mailbox_id: "mailbox-1",
      subject: "Re: hello",
      from_email: "lead@example.com",
      from_name: "Lead Name",
      to_emails: ["mailbox@example.com"],
      body_text: "Sounds good",
      body_html: "<p>Sounds good</p>",
      received_at: "2026-09-20T10:00:00.000Z",
    };

    const result = await recordEmailReply(client, values);

    expect(client.from).toHaveBeenCalledWith("email_replies");
    expect(chain.insert).toHaveBeenCalledWith(values);
    expect(result).toEqual(replyRow);
  });

  it("throws on an insert error (e.g. a unique-violation on email_event_id)", async () => {
    const { client } = createClient({ data: null, error: { code: "23505", message: "duplicate key" } });

    await expect(
      recordEmailReply(client, {
        email_event_id: "event-1",
        campaign_id: "campaign-1",
        lead_id: "lead-1",
        mailbox_id: "mailbox-1",
        from_email: "lead@example.com",
        received_at: "2026-09-20T10:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
