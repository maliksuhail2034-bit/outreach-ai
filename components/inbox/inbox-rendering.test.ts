import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/link needs the app router at render time; a plain anchor is all these
// markup assertions need.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import type { InboxReply } from "@/lib/db/email-replies";
import { InboxList } from "./inbox-list";
import { InboxPagination } from "./inbox-pagination";
import { ReplyMessage } from "./reply-message";

// Inbound mail is attacker-controlled: these pin that reply content only ever
// reaches the page as escaped text.
function reply(id: string, overrides: Partial<InboxReply> = {}): InboxReply {
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

const NOW = new Date("2026-09-28T12:00:00.000Z");

describe("ReplyMessage", () => {
  it("renders body_text as escaped text with its line breaks kept, never as HTML", () => {
    const html = renderToStaticMarkup(
      createElement(ReplyMessage, {
        reply: reply("r-1", { body_text: 'Hi <script>alert("x")</script>\n<img src=x onerror=alert(1)>\nThanks' }),
        isNew: false,
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("\nThanks");
  });

  it("never renders body_html, even when a row carries it", () => {
    const withHtml = { ...reply("r-1", { body_text: "plain words" }), body_html: "<b id=\"injected\">rich</b>" };
    const html = renderToStaticMarkup(createElement(ReplyMessage, { reply: withHtml, isNew: false }));

    expect(html).toContain("plain words");
    expect(html).not.toContain("injected");
    expect(html).not.toContain("rich");
  });

  it("shows (no subject), the email when there's no sender name, the recipients and a New badge", () => {
    const html = renderToStaticMarkup(
      createElement(ReplyMessage, {
        reply: reply("r-1", { subject: null, from_name: null, to_emails: ["a@x.com", "b@x.com"] }),
        isNew: true,
      }),
    );

    expect(html).toContain("(no subject)");
    expect(html).toContain("lead@example.com");
    expect(html).toContain("a@x.com, b@x.com");
    expect(html).toContain("New");
  });

  it("says so when there's no text body", () => {
    const html = renderToStaticMarkup(createElement(ReplyMessage, { reply: reply("r-1", { body_text: null }), isNew: false }));
    expect(html).toContain("(no text content)");
  });
});

describe("InboxList", () => {
  it("renders one row per reply, linking to its conversation", () => {
    const html = renderToStaticMarkup(createElement(InboxList, { replies: [reply("r-1")], now: NOW }));

    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).toContain('href="/inbox/r-1"');
    expect(html).toContain("Q4 outreach");
    expect(html).toContain("Me");
  });

  it("marks unread rows with text (not just color) and leaves read rows plain", () => {
    const html = renderToStaticMarkup(
      createElement(InboxList, {
        replies: [reply("r-1"), reply("r-2", { read_at: "2026-09-21T00:00:00.000Z" })],
        now: NOW,
      }),
    );

    expect(html.match(/Unread: /g)).toHaveLength(1);
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("keeps the same lead's replies from different campaigns as separate rows", () => {
    const html = renderToStaticMarkup(
      createElement(InboxList, {
        replies: [
          reply("r-1"),
          reply("r-2", { campaign_id: "campaign-2", campaign: { id: "campaign-2", name: "Webinar follow-up" } }),
        ],
        now: NOW,
      }),
    );

    expect(html).toContain("Q4 outreach");
    expect(html).toContain("Webinar follow-up");
    expect(html).toContain('href="/inbox/r-2"');
  });

  it("shows only an escaped snippet of the new text, never quoted history or markup", () => {
    const html = renderToStaticMarkup(
      createElement(InboxList, {
        replies: [reply("r-1", { body_text: "Yes <b>please</b>\n> old quoted text", subject: null })],
        now: NOW,
      }),
    );

    expect(html).toContain("Yes &lt;b&gt;please&lt;/b&gt;");
    expect(html).not.toContain("old quoted text");
    expect(html).toContain("(no subject)");
  });

  it("renders an empty list for no replies (the page shows its own empty state)", () => {
    const html = renderToStaticMarkup(createElement(InboxList, { replies: [], now: NOW }));
    expect(html).not.toContain("<li");
  });
});

describe("InboxPagination", () => {
  function render(page: number, totalCount: number) {
    return renderToStaticMarkup(createElement(InboxPagination, { page, pageSize: 25, totalCount }));
  }

  it("renders nothing when everything fits on one page", () => {
    expect(render(1, 0)).toBe("");
    expect(render(1, 25)).toBe("");
  });

  it("disables Previous on the first page and Next on the last", () => {
    const first = render(1, 26);
    expect(first).toContain("Page 1 of 2");
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*>Previous<\/button>/);
    expect(first).not.toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);

    const last = render(2, 26);
    expect(last).toContain("Page 2 of 2");
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
    expect(last).not.toMatch(/<button[^>]*disabled=""[^>]*>Previous<\/button>/);
  });
});
