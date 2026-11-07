import { describe, expect, it } from "vitest";

import { findSpamFolder } from "./inbox-agent";
import { computeDailyWarmupStats, summarizeWarmupStats } from "./stats";
import { calculateWarmupScore } from "./scoring";
import { composeInitialMessage, composeReplyMessage } from "./templates";
import { warmupHtml } from "./warmup-worker";

describe("findSpamFolder", () => {
  it("prefers the server's \\Junk special-use flag (Gmail's [Gmail]/Spam)", () => {
    expect(
      findSpamFolder([
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "Spam", name: "Spam" },
        { path: "[Gmail]/Spam", name: "Spam", specialUse: "\\Junk" },
      ]),
    ).toBe("[Gmail]/Spam");
  });

  it("falls back to common folder names (Outlook's Junk Email)", () => {
    expect(findSpamFolder([{ path: "INBOX", name: "INBOX" }, { path: "Junk Email", name: "Junk Email" }])).toBe("Junk Email");
    expect(findSpamFolder([{ path: "INBOX.Junk", name: "Junk" }])).toBe("INBOX.Junk");
  });

  it("returns null when there is no spam folder", () => {
    expect(findSpamFolder([{ path: "INBOX", name: "INBOX" }, { path: "Archive", name: "Archive" }])).toBeNull();
  });
});

describe("computeDailyWarmupStats placement", () => {
  it("derives spam rate from placed messages only", () => {
    const stats = computeDailyWarmupStats(
      [
        { message_type: "initial", reply_decision: "replied", placement: "inbox" },
        { message_type: "initial", reply_decision: "undecided", placement: "inbox" },
        { message_type: "initial", reply_decision: "undecided", placement: "inbox" },
        { message_type: "reply", reply_decision: "undecided", placement: "spam" },
        { message_type: "initial", reply_decision: "undecided", placement: null },
      ],
      3,
    );
    expect(stats).toMatchObject({ inboxCount: 3, spamCount: 1, spamRate: 25 });
  });

  it("leaves spam rate null with no known placement", () => {
    expect(computeDailyWarmupStats([{ message_type: "initial", reply_decision: "undecided" }], 0).spamRate).toBeNull();
  });
});

describe("summarizeWarmupStats", () => {
  it("sums days per profile and computes inbox rate", () => {
    const summary = summarizeWarmupStats([
      { warmup_profile_id: "p1", emails_sent: 10, emails_received: 8, positive_interactions: 4, inbox_count: 9, spam_count: 1 },
      { warmup_profile_id: "p1", emails_sent: 12, emails_received: 9, positive_interactions: 5, inbox_count: 10, spam_count: 0 },
      { warmup_profile_id: "p2", emails_sent: 3, emails_received: 1, positive_interactions: 0, inbox_count: 0, spam_count: 0 },
    ]);
    expect(summary.p1).toEqual({ sent: 22, received: 17, replies: 9, inbox: 19, spam: 1, inboxRate: 95 });
    expect(summary.p2.inboxRate).toBeNull();
  });
});

describe("calculateWarmupScore with placement", () => {
  const base = { stage: "healthy" as const, targetDailyVolume: 30, currentDailyVolume: 30 };

  it("is unaffected by a perfect inbox rate and pulled down by spam placement", () => {
    expect(calculateWarmupScore({ ...base, spamRate: 0 })).toBe(100);
    expect(calculateWarmupScore({ ...base, spamRate: 15 })).toBe(75);
    expect(calculateWarmupScore({ ...base, spamRate: 40 })).toBe(50);
  });
});

describe("composed warmup messages", () => {
  it("produces varied, non-empty subjects and bodies", () => {
    const messages = Array.from({ length: 200 }, () => composeInitialMessage("Sam Lee", "Ana Diaz"));
    for (const message of messages) {
      expect(message.subject.length).toBeGreaterThan(0);
      expect(message.body).not.toContain("{name}");
    }
    expect(new Set(messages.map((message) => message.body)).size).toBeGreaterThan(150);
  });

  it("addresses the recipient by first name and signs with the sender's", () => {
    const sequence = [0, 0, 0.5, 0, 0]; // greeting "Hi {name},", opener, body, sign-off, subject
    let index = 0;
    const message = composeInitialMessage("Sam Lee", "Ana Diaz", () => sequence[index++ % sequence.length]);
    expect(message.body.startsWith("Hi Sam,")).toBe(true);
    expect(message.body.endsWith("Ana")).toBe(true);
  });

  it("drops the name cleanly when there isn't a usable one", () => {
    const message = composeInitialMessage(null, null, () => 0);
    expect(message.body.startsWith("Hi,")).toBe(true);
    const odd = composeInitialMessage("<script>", undefined, () => 0);
    expect(odd.body).not.toContain("<script>");
  });

  it("composes short replies", () => {
    expect(composeReplyMessage("Ana").length).toBeGreaterThan(0);
  });
});

describe("warmupHtml", () => {
  it("turns paragraphs into escaped <p> blocks with line breaks", () => {
    expect(warmupHtml("Hi Sam,\n\nA <b> & B\n\nThanks!\nAna")).toBe("<p>Hi Sam,</p><p>A &lt;b&gt; &amp; B</p><p>Thanks!<br>Ana</p>");
  });
});
