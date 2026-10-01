import { describe, expect, it } from "vitest";
import { simpleParser, type SimpleParserOptions } from "mailparser";
import { isMailSystemSender, parseDeliveryReport } from "./delivery-report";

// Fixtures are hand-built raw messages in the RFC 3464 multipart/report
// shapes Gmail and Exchange/Outlook use (structure and field names follow
// those providers' notices; addresses and ids are made up). Parsed with real
// mailparser and the same keepDeliveryStatus option as
// lib/email/reply-providers/imap.ts, so these exercise the exact part
// shapes the reply worker receives.
const PARSER_OPTIONS: SimpleParserOptions & { keepDeliveryStatus: boolean } = { keepDeliveryStatus: true };

async function reportFrom(raw: string) {
  const parsed = await simpleParser(raw, PARSER_OPTIONS);
  return parseDeliveryReport({ contentType: parsed.headers.get("content-type"), parts: parsed.attachments });
}

function crlf(lines: string[]) {
  return lines.join("\r\n");
}

function recipientGroup(recipient: string, action: string, status: string) {
  return [`Final-Recipient: rfc822; ${recipient}`, `Action: ${action}`, `Status: ${status}`];
}

// Gmail ("Mail Delivery Subsystem"): the full original message is returned
// as message/rfc822.
function gmailReport(groups: string[][], options: { reportType?: string; original?: boolean } = {}) {
  return crlf([
    "Return-Path: <>",
    "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    "To: sales@example.com",
    "Subject: Delivery Status Notification (Failure)",
    "Message-ID: <ndr-1@mx.google.com>",
    "In-Reply-To: <sent-1@example.com>",
    "References: <sent-1@example.com>",
    "Auto-Submitted: auto-replied",
    "MIME-Version: 1.0",
    `Content-Type: multipart/report; boundary="b1"; report-type=${options.reportType ?? "delivery-status"}`,
    "",
    "--b1",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "Address not found. Your message wasn't delivered.",
    "--b1",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; googlemail.com",
    "Arrival-Date: Thu, 01 Oct 2026 05:00:00 -0700",
    "",
    groups.map((group) => group.join("\r\n")).join("\r\n\r\n"),
    "",
    ...(options.original === false
      ? []
      : [
          "--b1",
          "Content-Type: message/rfc822",
          "",
          "From: Sales <sales@example.com>",
          "To: dead@prospect.test",
          "Subject: Quick question",
          "Message-ID: <sent-1@example.com>",
          "",
          "Hello there. Message-ID: <not-this-one@example.com>",
        ]),
    "--b1--",
    "",
  ]);
}

// Exchange/Outlook: the original's headers only, as text/rfc822-headers,
// with folded header lines and no space after the address-type separator.
const EXCHANGE_REPORT = crlf([
  "From: Microsoft Outlook <MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@contoso.test>",
  "To: sales@example.com",
  "Subject: Undeliverable: Quick question",
  "Message-ID: <ndr-2@contoso.test>",
  "Auto-Submitted: auto-replied",
  "MIME-Version: 1.0",
  'Content-Type: multipart/report; report-type="delivery-status";',
  ' boundary="b2"',
  "",
  "--b2",
  "Content-Type: text/plain; charset=us-ascii",
  "",
  "Delivery has failed to these recipients or groups.",
  "--b2",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns;PH0PR00MB0000.namprd00.prod.outlook.test",
  "",
  "Final-Recipient: rfc822;Dead@Prospect.test",
  "Action: failed",
  "Status: 5.1.10",
  "Diagnostic-Code: smtp;550 5.1.10 RESOLVER.ADR.RecipientNotFound;",
  " Recipient not found by SMTP address lookup",
  "",
  "--b2",
  "Content-Type: text/rfc822-headers",
  "",
  "From: Sales <sales@example.com>",
  "To: <dead@prospect.test>",
  "Subject: Quick question",
  "Message-ID:",
  " <sent-2@example.com>",
  "",
  "--b2--",
  "",
]);

describe("parseDeliveryReport — hard bounces", () => {
  it("reads a Gmail notice: the failed address and the original Message-ID (not one quoted in the body)", async () => {
    expect(await reportFrom(gmailReport([recipientGroup("dead@prospect.test", "failed", "5.1.1")]))).toEqual({
      hardBouncedRecipients: ["dead@prospect.test"],
      originalMessageId: "sent-1@example.com",
    });
  });

  it("reads an Exchange notice with folded headers, original headers only, and lowercases the address", async () => {
    expect(await reportFrom(EXCHANGE_REPORT)).toEqual({
      hardBouncedRecipients: ["dead@prospect.test"],
      originalMessageId: "sent-2@example.com",
    });
  });

  it.each(["5.1.1", "5.1.2", "5.1.3", "5.1.6", "5.1.10", "5.2.1"])(
    "treats %s (an address-level status, same as the synchronous path) as a hard bounce",
    async (status) => {
      const report = await reportFrom(gmailReport([recipientGroup("dead@prospect.test", "failed", status)]));
      expect(report?.hardBouncedRecipients).toEqual(["dead@prospect.test"]);
    },
  );

  it("accepts a status followed by a comment", async () => {
    const report = await reportFrom(gmailReport([recipientGroup("dead@prospect.test", "failed", "5.1.1 (bad destination mailbox address)")]));
    expect(report?.hardBouncedRecipients).toEqual(["dead@prospect.test"]);
  });

  it("lists only the hard-bounced recipients of a multi-recipient notice", async () => {
    const report = await reportFrom(
      gmailReport([
        recipientGroup("dead@prospect.test", "failed", "5.1.1"),
        recipientGroup("slow@prospect.test", "delayed", "4.4.7"),
        recipientGroup("blocked@prospect.test", "failed", "5.7.1"),
      ]),
    );
    expect(report?.hardBouncedRecipients).toEqual(["dead@prospect.test"]);
  });

  it("returns a null original Message-ID when the notice doesn't include the original message", async () => {
    const report = await reportFrom(gmailReport([recipientGroup("dead@prospect.test", "failed", "5.1.1")], { original: false }));
    expect(report).toEqual({ hardBouncedRecipients: ["dead@prospect.test"], originalMessageId: null });
  });
});

describe("parseDeliveryReport — delivery reports that suppress nobody", () => {
  it.each([
    ["a delay notice", "delayed", "4.4.7"],
    ["a temporary failure", "failed", "4.2.2"],
    ["a policy/spam block", "failed", "5.7.1"],
    ["a full mailbox", "failed", "5.2.2"],
    ["a message-size rejection", "failed", "5.3.4"],
    ["a delivered report", "delivered", "2.0.0"],
    ["a failed action with no status", "failed", ""],
  ])("is still a delivery report, with no hard-bounced recipient, for %s", async (_label, action, status) => {
    const report = await reportFrom(gmailReport([recipientGroup("someone@prospect.test", action, status)]));
    expect(report).toEqual({ hardBouncedRecipients: [], originalMessageId: "sent-1@example.com" });
  });

  it("ignores a recipient that isn't an rfc822 address", async () => {
    const report = await reportFrom(gmailReport([["Final-Recipient: x400; c=US;a= ;p=Contoso;", "Action: failed", "Status: 5.1.1"]]));
    expect(report?.hardBouncedRecipients).toEqual([]);
  });
});

describe("parseDeliveryReport — not a delivery report", () => {
  it("a human reply", async () => {
    const raw = crlf([
      "From: Lead Name <lead@prospect.test>",
      "To: sales@example.com",
      "Subject: Re: Quick question",
      "Message-ID: <reply-1@prospect.test>",
      "In-Reply-To: <sent-1@example.com>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Sounds good. Final-Recipient: rfc822; dead@prospect.test / Action: failed / Status: 5.1.1",
      "",
    ]);
    expect(await reportFrom(raw)).toBeNull();
  });

  it("an out-of-office auto-reply", async () => {
    const raw = crlf([
      "From: Lead Name <lead@prospect.test>",
      "To: sales@example.com",
      "Subject: Automatic reply: Quick question",
      "Message-ID: <ooo-1@prospect.test>",
      "In-Reply-To: <sent-1@example.com>",
      "Auto-Submitted: auto-replied",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b3"',
      "",
      "--b3",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "I'm out of the office until Monday.",
      "--b3",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<p>I'm out of the office until Monday.</p>",
      "--b3--",
      "",
    ]);
    expect(await reportFrom(raw)).toBeNull();
  });

  it("a read receipt (a multipart/report of another report type)", async () => {
    expect(
      await reportFrom(gmailReport([recipientGroup("dead@prospect.test", "failed", "5.1.1")], { reportType: "disposition-notification" })),
    ).toBeNull();
  });

  it("a message with no Content-Type", () => {
    expect(parseDeliveryReport({ contentType: undefined, parts: [] })).toBeNull();
  });
});

describe("isMailSystemSender", () => {
  it.each(["mailer-daemon@googlemail.com", "MAILER-DAEMON@mx.prospect.test", "postmaster@outlook.test"])("%s → true", (email) => {
    expect(isMailSystemSender(email)).toBe(true);
  });

  it.each(["lead@prospect.test", "daemon@prospect.test", "mailer-daemon.team@prospect.test", "postmaster", "@prospect.test"])(
    "%s → false",
    (email) => {
      expect(isMailSystemSender(email)).toBe(false);
    },
  );
});
