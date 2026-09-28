import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { CountQueryError } from "./shared";
import {
  countUnreadEmailReplies,
  getEmailReplyByEventId,
  getEmailReplyThread,
  INBOX_REPLY_SELECT,
  listEmailRepliesPage,
  markEmailRepliesRead,
  recordEmailReply,
} from "./email-replies";

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

// --- Unified inbox ----------------------------------------------------------

// Each from() call gets its own recording chain resolving to the next queued
// result, so multi-query functions can be driven step by step.
function createQueuedClient(...results: unknown[]) {
  const queue = [...results];
  const chains: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const from = vi.fn(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
    for (const method of ["select", "eq", "in", "is", "order", "range", "limit", "update"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.maybeSingle = vi.fn(() => Promise.resolve(result));
    chain.then = (resolve: (value: unknown) => void) => resolve(result);
    chains.push(chain);
    return chain;
  });
  return { client: { from } as unknown as Client, from, chains };
}

function inboxRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    subject: "Re: hello",
    from_email: "lead@example.com",
    from_name: "Lead Name",
    to_emails: ["me@example.com"],
    body_text: "Sounds good",
    received_at: "2026-09-20T10:00:00.000Z",
    read_at: null,
    lead: { id: "lead-1", first_name: "Lead", last_name: "Name", email: "lead@example.com", company: null },
    campaign: { id: "campaign-1", name: "Q4 outreach" },
    mailbox: { id: "mailbox-1", email: "me@example.com", display_name: "Me" },
    ...overrides,
  };
}

const REPLY_ID = "11111111-1111-4111-8111-111111111111";

describe("INBOX_REPLY_SELECT", () => {
  it("names the mailbox's display columns explicitly — never mailboxes(*) or any credential column", () => {
    expect(INBOX_REPLY_SELECT).toContain("mailbox:mailboxes(id, email, display_name)");
    expect(INBOX_REPLY_SELECT).not.toMatch(/mailboxes\(\s*\*/);
    expect(INBOX_REPLY_SELECT).not.toMatch(/encrypted|password|token|smtp|imap/i);
  });

  it("never selects body_html — the inbox renders body_text only", () => {
    expect(INBOX_REPLY_SELECT).not.toContain("body_html");
    expect(INBOX_REPLY_SELECT).toContain("body_text");
  });

  it("embeds only the lead and campaign fields the inbox shows", () => {
    expect(INBOX_REPLY_SELECT).toContain("lead:leads(id, first_name, last_name, email, company)");
    expect(INBOX_REPLY_SELECT).toContain("campaign:campaigns(id, name)");
  });
});

describe("listEmailRepliesPage", () => {
  it("reads newest first (received_at, then id) with an exact count, one page", async () => {
    const rows = [inboxRow("r-2"), inboxRow("r-1")];
    const { client, from, chains } = createQueuedClient({ data: rows, count: 30, error: null });

    const result = await listEmailRepliesPage(client, { page: 2, pageSize: 25 });

    expect(from).toHaveBeenCalledWith("email_replies");
    expect(chains[0].select).toHaveBeenCalledWith(INBOX_REPLY_SELECT, { count: "exact" });
    expect(chains[0].order).toHaveBeenNthCalledWith(1, "received_at", { ascending: false });
    expect(chains[0].order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(chains[0].range).toHaveBeenCalledWith(25, 49);
    expect(result).toEqual({ replies: rows, page: 2, pageSize: 25, totalCount: 30 });
  });

  it("defaults to page 1 and clamps a non-positive page", async () => {
    const { client, chains } = createQueuedClient({ data: [], count: 0, error: null });

    const result = await listEmailRepliesPage(client, { page: 0, pageSize: 25 });

    expect(chains[0].range).toHaveBeenCalledWith(0, 24);
    expect(result).toEqual({ replies: [], page: 1, pageSize: 25, totalCount: 0 });
  });

  it("falls back to the last real page when the requested page is past the end (PGRST103)", async () => {
    const lastPage = [inboxRow("r-1")];
    const { client, chains } = createQueuedClient(
      { data: null, count: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } },
      { data: null, count: 26, error: null, status: 200, statusText: "OK" },
      { data: lastPage, count: 26, error: null },
    );

    const result = await listEmailRepliesPage(client, { page: 9, pageSize: 25 });

    expect(chains[2].range).toHaveBeenCalledWith(25, 49);
    expect(result).toEqual({ replies: lastPage, page: 2, pageSize: 25, totalCount: 26 });
  });

  it("propagates any other query error", async () => {
    const error = { code: "42501", message: "permission denied" };
    const { client } = createQueuedClient({ data: null, count: null, error });

    await expect(listEmailRepliesPage(client)).rejects.toBe(error);
  });
});

describe("getEmailReplyThread", () => {
  it("resolves the reply, then returns its campaign + lead conversation oldest first", async () => {
    const replies = [inboxRow("r-1"), inboxRow("r-2", { received_at: "2026-09-21T10:00:00.000Z" })];
    const { client, chains } = createQueuedClient(
      { data: { id: REPLY_ID, campaign_id: "campaign-1", lead_id: "lead-1" }, error: null },
      { data: replies, error: null },
    );

    const thread = await getEmailReplyThread(client, REPLY_ID);

    expect(chains[0].eq).toHaveBeenCalledWith("id", REPLY_ID);
    expect(chains[1].select).toHaveBeenCalledWith(INBOX_REPLY_SELECT);
    expect(chains[1].eq).toHaveBeenCalledWith("campaign_id", "campaign-1");
    expect(chains[1].eq).toHaveBeenCalledWith("lead_id", "lead-1");
    expect(chains[1].order).toHaveBeenNthCalledWith(1, "received_at", { ascending: true });
    expect(chains[1].order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(thread).toEqual({ campaignId: "campaign-1", leadId: "lead-1", replies });
  });

  it("keeps the same lead's replies in another campaign out of the conversation (keyed on campaign + lead)", async () => {
    const { client, chains } = createQueuedClient(
      { data: { id: REPLY_ID, campaign_id: "campaign-2", lead_id: "lead-1" }, error: null },
      { data: [inboxRow("r-9", { campaign_id: "campaign-2" })], error: null },
    );

    await getEmailReplyThread(client, REPLY_ID);

    expect(chains[1].eq).toHaveBeenCalledWith("campaign_id", "campaign-2");
    expect(chains[1].eq).not.toHaveBeenCalledWith("campaign_id", "campaign-1");
  });

  it("returns null when the reply doesn't exist or RLS hides it (another user's reply)", async () => {
    const { client, from } = createQueuedClient({ data: null, error: null });

    expect(await getEmailReplyThread(client, REPLY_ID)).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("returns null for a malformed id without querying", async () => {
    const { client, from } = createQueuedClient();

    expect(await getEmailReplyThread(client, "not-a-uuid")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("propagates query errors", async () => {
    const error = { code: "57014", message: "statement timeout" };
    const { client } = createQueuedClient({ data: null, error });

    await expect(getEmailReplyThread(client, REPLY_ID)).rejects.toBe(error);
  });
});

describe("countUnreadEmailReplies", () => {
  it("counts replies with no read_at", async () => {
    const { client, chains } = createQueuedClient({ data: null, count: 3, error: null, status: 200, statusText: "OK" });

    expect(await countUnreadEmailReplies(client)).toBe(3);
    expect(chains[0].select).toHaveBeenCalledWith("*", { count: "exact", head: true });
    expect(chains[0].is).toHaveBeenCalledWith("read_at", null);
  });

  it("returns 0 when nothing is unread", async () => {
    const { client } = createQueuedClient({ data: null, count: 0, error: null, status: 200, statusText: "OK" });
    expect(await countUnreadEmailReplies(client)).toBe(0);
  });

  it("keeps the HTTP status of a bodyless count failure", async () => {
    const { client } = createQueuedClient({ data: null, count: null, error: { message: "" }, status: 503, statusText: "" });
    await expect(countUnreadEmailReplies(client)).rejects.toBeInstanceOf(CountQueryError);
  });
});

describe("markEmailRepliesRead", () => {
  it("writes read_at only, for the given still-unread replies", async () => {
    const { client, chains } = createQueuedClient({ data: null, error: null });
    const readAt = new Date("2026-09-28T12:00:00.000Z");

    await markEmailRepliesRead(client, ["r-1", "r-2"], readAt);

    expect(chains[0].update).toHaveBeenCalledWith({ read_at: "2026-09-28T12:00:00.000Z" });
    expect(chains[0].in).toHaveBeenCalledWith("id", ["r-1", "r-2"]);
    expect(chains[0].is).toHaveBeenCalledWith("read_at", null);
  });

  it("does nothing for an empty list", async () => {
    const { client, from } = createQueuedClient();
    await markEmailRepliesRead(client, []);
    expect(from).not.toHaveBeenCalled();
  });

  it("propagates an update error", async () => {
    const error = { code: "42501", message: "permission denied" };
    const { client } = createQueuedClient({ data: null, error });
    await expect(markEmailRepliesRead(client, ["r-1"])).rejects.toBe(error);
  });
});
