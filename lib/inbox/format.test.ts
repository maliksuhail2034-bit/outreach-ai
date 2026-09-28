import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  parseInboxPage,
  replyLeadName,
  replySenderName,
  replySnippet,
  replySubject,
} from "./format";

describe("replySubject", () => {
  it("falls back to (no subject) for a missing or blank subject", () => {
    expect(replySubject({ subject: null })).toBe("(no subject)");
    expect(replySubject({ subject: "   " })).toBe("(no subject)");
    expect(replySubject({ subject: "Re: pricing" })).toBe("Re: pricing");
  });
});

describe("replySenderName", () => {
  it("falls back from from_name to the sender's email", () => {
    expect(replySenderName({ from_name: "Ada Lovelace", from_email: "ada@example.com" })).toBe("Ada Lovelace");
    expect(replySenderName({ from_name: null, from_email: "ada@example.com" })).toBe("ada@example.com");
    expect(replySenderName({ from_name: " ", from_email: "ada@example.com" })).toBe("ada@example.com");
  });
});

describe("replyLeadName", () => {
  const lead = { id: "lead-1", first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", company: null };

  it("uses the lead's name, then its email, then the sender's address", () => {
    expect(replyLeadName({ lead, from_email: "x@example.com" })).toBe("Ada Lovelace");
    expect(replyLeadName({ lead: { ...lead, first_name: null, last_name: null }, from_email: "x@example.com" })).toBe(
      "ada@example.com",
    );
    expect(replyLeadName({ lead: null, from_email: "x@example.com" })).toBe("x@example.com");
  });
});

describe("replySnippet", () => {
  it("drops quoted lines, collapses whitespace and truncates", () => {
    const body = "Sounds great,\n\ncall me Tuesday.\n\n> On Mon, you wrote:\n> Are you free?";
    expect(replySnippet(body)).toBe("Sounds great, call me Tuesday.");
    expect(replySnippet("a".repeat(200), 20)).toBe(`${"a".repeat(19)}…`);
  });

  it("is empty for a missing body", () => {
    expect(replySnippet(null)).toBe("");
  });

  it("keeps markup as literal text (it's never interpreted)", () => {
    expect(replySnippet("<b>hi</b> <script>x</script>")).toBe("<b>hi</b> <script>x</script>");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("describes past instants relative to now", () => {
    expect(formatRelativeTime("2026-09-28T11:59:40.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-09-28T11:55:00.000Z", now)).toBe("5 minutes ago");
    expect(formatRelativeTime("2026-09-28T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-09-27T12:00:00.000Z", now)).toBe("yesterday");
    expect(formatRelativeTime("2026-09-14T12:00:00.000Z", now)).toBe("2 weeks ago");
  });
});

describe("parseInboxPage", () => {
  it("accepts positive integers and falls back to page 1 otherwise", () => {
    expect(parseInboxPage("3")).toBe(3);
    expect(parseInboxPage(undefined)).toBe(1);
    expect(parseInboxPage("0")).toBe(1);
    expect(parseInboxPage("-2")).toBe(1);
    expect(parseInboxPage("1.5")).toBe(1);
    expect(parseInboxPage("abc")).toBe(1);
  });
});
