import { describe, expect, it } from "vitest";
import { EmailSendError } from "../provider";
import { classifySmtpError } from "./smtp";

// Mirrors the error shape nodemailer's SMTPConnection._formatError builds:
// `code`, the raw server `response` line, the numeric `responseCode` parsed
// from it, the SMTP `command` stage, and the response appended to `message`.
function smtpError(command: string | undefined, response: string, code = "EENVELOPE") {
  const err = new Error(`Command failed: ${response}`) as Error & {
    code: string;
    response: string;
    responseCode: number;
    command?: string;
  };
  err.code = code;
  err.response = response;
  err.responseCode = Number(response.match(/^\d+/)?.[0]);
  if (command) err.command = command;
  return err;
}

function outcomeOf(error: unknown) {
  const classified = classifySmtpError(error);
  expect(classified).toBeInstanceOf(EmailSendError);
  return classified.outcome;
}

describe("classifySmtpError — clear recipient bounces", () => {
  it.each([
    ["550 5.1.1 recipient does not exist", "550-5.1.1 The email account that you tried to reach does not exist."],
    ["550 5.1.10 Microsoft recipient not found", "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup"],
    ["553 5.1.3 invalid address", "553 5.1.3 <bad@@example.com>: invalid address"],
    ["bare 550 User unknown", "550 User unknown"],
  ])("RCPT TO + %s → bounced", (_label, response) => {
    expect(outcomeOf(smtpError("RCPT TO", response))).toBe("bounced");
  });
});

describe("classifySmtpError — sender-side, policy and ambiguous 5xx", () => {
  it.each([
    ["RCPT TO", "550 5.7.1 Relaying denied"],
    ["RCPT TO", "554 5.7.1 Message rejected due to spam policy"],
    ["MAIL FROM", "550 5.4.5 Daily user sending limit exceeded."],
    ["MAIL FROM", "553 5.7.1 <me@example.com>: Sender address rejected: not owned by user"],
    ["DATA", "554 5.2.252 SendAsDenied; me@example.com not allowed to send as other@example.com"],
    ["DATA", "550 5.7.26 This mail is unauthenticated, which poses a security risk (DMARC)"],
    ["DATA", "554 5.2.0 STOREDRV.Submission.Exception:OutboundSpamException"],
    ["DATA", "554 Message rejected: Email address is not verified."],
    ["RCPT TO", "550 Requested action not taken: mailbox unavailable"],
    ["RCPT TO", "552 5.2.2 Mailbox full"],
    ["RCPT TO", "554 Transaction failed"],
    ["RCPT TO", "550 5.7.1 User unknown or access denied"],
    ["RCPT TO", "599 Something unexpected happened"],
  ])("%s + %s → failed", (command, response) => {
    expect(outcomeOf(smtpError(command, response))).toBe("failed");
  });

  it("AUTH + 535 → failed", () => {
    expect(outcomeOf(smtpError("AUTH PLAIN", "535 5.7.8 Username and Password not accepted.", "EAUTH"))).toBe("failed");
  });

  it("a 5.1.1 response with no SMTP command is not treated as a bounce", () => {
    expect(outcomeOf(smtpError(undefined, "550 5.1.1 The email account that you tried to reach does not exist."))).toBe(
      "failed",
    );
  });

  it("never suppresses a recipient over a sender-stage rejection that mentions an unknown user", () => {
    expect(outcomeOf(smtpError("MAIL FROM", "550 5.1.1 User unknown"))).toBe("failed");
  });
});

// Postfix and Exim run sender checks at RCPT TO, so a recipient-stage 5xx
// without an enhanced code can still be about our own sender address.
describe("classifySmtpError — sender wording and #-prefixed enhanced codes", () => {
  it.each([
    [
      "Exim sender verification mentioning User unknown",
      "550-Verification failed for <me@example.com>\n550-Called: 192.0.2.1\n550-Sent: RCPT TO:<me@example.com>\n550-Response: 550 5.1.1 User unknown\n550 Sender verify failed",
    ],
    ["553 Sender address invalid: user unknown", "553 Sender address invalid: user unknown in local recipient table"],
    ["550 Sender domain does not exist", "550 Sender domain does not exist"],
    ["550 #5.7.1 sender does not exist", "550 #5.7.1 sender does not exist in directory"],
    ["bare 550 mentioning the from address", "550 From address user unknown"],
  ])("RCPT TO + %s → failed", (_label, response) => {
    expect(outcomeOf(smtpError("RCPT TO", response))).toBe("failed");
  });

  it.each([
    ["#5.1.1 genuine recipient rejection", "550 #5.1.1 RESOLVER.ADR.RecipientNotFound; not found"],
    ["plain 5.1.1 recipient rejection", "550 5.1.1 <bob@example.com>: Recipient address rejected: User unknown"],
  ])("RCPT TO + %s → bounced", (_label, response) => {
    expect(outcomeOf(smtpError("RCPT TO", response))).toBe("bounced");
  });

  it.each(["550 5.7.1 User unknown or access denied", "550 #5.7.1 User unknown"])(
    "RCPT TO + %s → failed (5.7.1 stays failed)",
    (response) => {
      expect(outcomeOf(smtpError("RCPT TO", response))).toBe("failed");
    },
  );

  it("ignores an enhanced code quoted later in the text", () => {
    expect(outcomeOf(smtpError("RCPT TO", "550 Policy rejection, ref 5.1.1"))).toBe("failed");
  });
});

describe("classifySmtpError — unchanged retry behavior", () => {
  it.each(["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED", "ESOCKET", "EDNS", "ETLS"])("%s → retry", (code) => {
    const err = Object.assign(new Error("connection problem"), { code });
    expect(outcomeOf(err)).toBe("retry");
  });

  it("replaces the ETIMEDOUT message with a friendly one", () => {
    const err = Object.assign(new Error("Greeting never received"), { code: "ETIMEDOUT" });
    expect(classifySmtpError(err).message).toMatch(/Couldn't reach the mail server in time/);
  });

  it.each([
    ["RCPT TO", "421 4.7.0 Try again later, closing connection."],
    ["RCPT TO", "450 4.2.1 The user you are trying to contact is receiving mail too quickly."],
    ["DATA", "451 4.3.0 Temporary server error."],
  ])("%s + %s → retry", (command, response) => {
    expect(outcomeOf(smtpError(command, response))).toBe("retry");
  });

  it.each([
    ["plain Error", new Error("something odd")],
    ["EAUTH without a server response", Object.assign(new Error("Missing credentials"), { code: "EAUTH" })],
    ["non-Error value", "boom"],
  ])("unknown shape (%s) → retry", (_label, error) => {
    expect(outcomeOf(error)).toBe("retry");
  });

  it("keeps the server response in the message for last_error", () => {
    const err = smtpError("RCPT TO", "550 5.1.1 User unknown");
    expect(classifySmtpError(err).message).toContain("550 5.1.1 User unknown");
  });
});
