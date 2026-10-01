import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/types/database.types";
import { EmailSendError } from "../provider";
import { classifySmtpError, SmtpEmailProvider } from "./smtp";

// Only the token refresh and decryption are replaced; the OAuth error
// classes stay real so smtp.ts's instanceof checks run exactly as in
// production. The classifySmtpError tests never reach either.
const oauth = vi.hoisted(() => ({ refreshGoogle: vi.fn(), refreshMicrosoft: vi.fn() }));
vi.mock("@/lib/email/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/google-oauth")>()),
  refreshGoogleAccessToken: oauth.refreshGoogle,
}));
vi.mock("@/lib/email/microsoft-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/microsoft-oauth")>()),
  refreshMicrosoftAccessToken: oauth.refreshMicrosoft,
}));
vi.mock("@/lib/crypto/smtp-secret", () => ({ decryptSmtpPassword: () => "decrypted-refresh-token" }));

import { GoogleOAuthError } from "@/lib/email/google-oauth";
import { MicrosoftOAuthError } from "@/lib/email/microsoft-oauth";

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

function classificationOf(error: unknown) {
  const { outcome, mailboxIssue } = classifySmtpError(error);
  return { outcome, mailboxIssue };
}

describe("classifySmtpError — mailboxIssue marks only mailbox/sender-identity failures", () => {
  it.each([
    ["AUTH PLAIN", "535 5.7.8 Username and Password not accepted.", "EAUTH"],
    ["AUTH LOGIN", "534-5.7.9 Application-specific password required.", "EAUTH"],
    ["MAIL FROM", "553 5.7.1 <me@example.com>: Sender address rejected: not owned by user", "EENVELOPE"],
    ["MAIL FROM", "550 5.1.8 Access denied, bad outbound sender", "EENVELOPE"],
    ["MAIL FROM", "550 5.4.5 Daily user sending limit exceeded.", "EENVELOPE"],
    ["RCPT TO", "550 5.7.1 Relaying denied", "EENVELOPE"],
    ["DATA", "550 5.7.26 This mail is unauthenticated (DMARC)", "EMESSAGE"],
    ["DATA", "554 5.2.252 SendAsDenied; not allowed to send as this sender", "EMESSAGE"],
  ])("%s + %s → failed + mailboxIssue", (command, response, code) => {
    expect(classificationOf(smtpError(command, response, code))).toEqual({ outcome: "failed", mailboxIssue: true });
  });

  it.each([
    ["MAIL FROM", "552 5.3.4 Message size exceeds fixed limit", "failed"],
    ["RCPT TO", "550 5.1.1 The email account that you tried to reach does not exist.", "bounced"],
    ["RCPT TO", "421 4.7.0 Try again later", "retry"],
    ["MAIL FROM", "451 4.3.0 Temporary server error", "retry"],
    ["AUTH PLAIN", "454 4.7.0 Temporary authentication failure", "retry"],
    [undefined, "550 5.7.1 Unknown stage rejection", "failed"],
  ])("%s + %s → %s without mailboxIssue", (command, response, outcome) => {
    const code = command?.startsWith("AUTH") ? "EAUTH" : "EENVELOPE";
    expect(classificationOf(smtpError(command, response, code))).toEqual({ outcome, mailboxIssue: false });
  });

  it.each(["ETIMEDOUT", "ECONNECTION", "ECONNREFUSED"])("%s → retry without mailboxIssue", (code) => {
    expect(classificationOf(Object.assign(new Error("network"), { code }))).toEqual({ outcome: "retry", mailboxIssue: false });
  });

  it("an unknown error shape → retry without mailboxIssue", () => {
    expect(classificationOf(new Error("something odd"))).toEqual({ outcome: "retry", mailboxIssue: false });
  });
});

describe("classifySmtpError — sender-level rejections after MAIL FROM protect the mailbox", () => {
  it.each([
    ["DATA", "550-5.7.26 Unauthenticated email from example.test is not accepted due to domain's DMARC policy."],
    ["RCPT TO", "550 5.7.26 This mail is unauthenticated, which poses a security risk (DMARC)"],
    ["DATA", "550 5.7.23 SPF validation failed"],
    ["DATA", "550 5.7.24 SPF validation error"],
    ["DATA", "550 5.7.25 Reverse DNS validation failed"],
    ["RCPT TO", "550 5.7.27 Sender address has null MX"],
    ["DATA", "554 5.2.252 SendAsDenied; me@example.com not allowed to send as other@example.com"],
    ["DATA", "554 5.2.0 STOREDRV.Submission.Exception:OutboundSpamException"],
    ["DATA", "554 Message rejected: Email address is not verified."],
    ["RCPT TO", "554 5.7.1 <lead@example.com>: Relay access denied"],
    ["RCPT TO", "550 5.7.1 Relaying not permitted"],
    ["RCPT TO", "553 5.7.1 <me@example.com>: Sender address rejected: not owned by user"],
    ["RCPT TO", "553 Sender address invalid: user unknown in local recipient table"],
    ["RCPT TO", "550 Sender domain does not exist"],
    ["RCPT TO", "550 #5.7.1 sender does not exist in directory"],
    ["RCPT TO", "550 5.7.1 Sender verify failed"],
  ])("%s + %s → failed + mailboxIssue", (command, response) => {
    expect(classificationOf(smtpError(command, response))).toEqual({ outcome: "failed", mailboxIssue: true });
  });

  it.each([
    ["RCPT TO", "554 5.7.1 Message rejected due to spam policy"],
    ["DATA", "550 5.7.1 Message content rejected"],
    ["RCPT TO", "550 5.7.1 User unknown or access denied"],
    ["RCPT TO", "550 Requested action not taken: mailbox unavailable"],
    ["RCPT TO", "552 5.2.2 Mailbox full"],
    ["RCPT TO", "554 Transaction failed"],
    ["RCPT TO", "550 From address user unknown"],
    ["RCPT TO", "550 Policy rejection, ref 5.7.26"],
    // A provider quota is only mailbox-level at MAIL FROM (above), as before.
    ["DATA", "550 5.4.5 Daily user sending limit exceeded."],
    // Without a known stage nothing can be attributed to the sender.
    [undefined, "550 5.7.26 This mail is unauthenticated (DMARC)"],
  ])("%s + %s → failed without mailboxIssue (ambiguous: stays lead-level)", (command, response) => {
    expect(classificationOf(smtpError(command, response))).toEqual({ outcome: "failed", mailboxIssue: false });
  });

  it.each([
    "550 5.1.1 <lead@example.com>: Recipient address rejected: User unknown",
    "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup",
  ])("a recipient bounce stays bounced and never blames the mailbox: %s", (response) => {
    expect(classificationOf(smtpError("RCPT TO", response))).toEqual({ outcome: "bounced", mailboxIssue: false });
  });

  it.each([
    ["DATA", "451 4.7.26 Temporary DMARC evaluation failure"],
    ["RCPT TO", "450 4.7.1 <me@example.com>: Sender address rejected: Domain not found"],
    ["RCPT TO", "421 4.7.0 Relaying temporarily denied"],
  ])("a 4xx stays retry and never trips the mailbox: %s + %s", (command, response) => {
    expect(classificationOf(smtpError(command, response))).toEqual({ outcome: "retry", mailboxIssue: false });
  });

  it.each(["ESOCKET", "EDNS", "ETLS"])("%s → retry without mailboxIssue", (code) => {
    expect(classificationOf(Object.assign(new Error("network"), { code }))).toEqual({ outcome: "retry", mailboxIssue: false });
  });
});

describe("SmtpEmailProvider — OAuth credential failures", () => {
  function oauthMailbox(overrides: Partial<Tables<"mailboxes">>): Tables<"mailboxes"> {
    return {
      id: "mailbox-1",
      email: "sender@example.test",
      encrypted_google_refresh_token: "enc-google",
      encrypted_microsoft_refresh_token: "enc-microsoft",
      ...overrides,
    } as Tables<"mailboxes">;
  }
  const message = { from: { email: "sender@example.test" }, to: { email: "lead@example.test" }, subject: "Hi", html: "<p>Hi</p>" };

  async function sendError(mailbox: Tables<"mailboxes">) {
    const error = await new SmtpEmailProvider(mailbox).send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    const { outcome, mailboxIssue } = error as EmailSendError;
    return { outcome, mailboxIssue };
  }

  beforeEach(() => {
    oauth.refreshGoogle.mockReset();
    oauth.refreshMicrosoft.mockReset();
  });

  it.each([
    ["Google", "gmail", () => oauth.refreshGoogle.mockRejectedValue(new GoogleOAuthError("Token has been expired or revoked.", "invalid_grant"))],
    ["Microsoft", "outlook", () => oauth.refreshMicrosoft.mockRejectedValue(new MicrosoftOAuthError("AADSTS70008 expired grant", "invalid_grant"))],
  ])("%s invalid_grant → failed + mailboxIssue", async (_label, provider, arrange) => {
    arrange();
    expect(await sendError(oauthMailbox({ email_provider: provider }))).toEqual({ outcome: "failed", mailboxIssue: true });
  });

  it.each([
    ["Google", "gmail", () => oauth.refreshGoogle.mockRejectedValue(new GoogleOAuthError("Google token request failed (503).", "retry"))],
    ["Microsoft", "outlook", () => oauth.refreshMicrosoft.mockRejectedValue(new MicrosoftOAuthError("Microsoft token request failed (429).", "retry"))],
  ])("%s transient refresh failure → retry without mailboxIssue", async (_label, provider, arrange) => {
    arrange();
    expect(await sendError(oauthMailbox({ email_provider: provider }))).toEqual({ outcome: "retry", mailboxIssue: false });
  });

  it("a non-invalid_grant terminal OAuth failure stays failed without mailboxIssue", async () => {
    oauth.refreshGoogle.mockRejectedValue(new GoogleOAuthError("Google did not return an access token for this refresh.", "failed"));
    expect(await sendError(oauthMailbox({ email_provider: "gmail" }))).toEqual({ outcome: "failed", mailboxIssue: false });
  });

  it.each([
    ["Google", { email_provider: "gmail", encrypted_google_refresh_token: null }],
    ["Microsoft", { email_provider: "outlook", encrypted_microsoft_refresh_token: null }],
  ])("missing %s refresh token → failed + mailboxIssue, without calling the token endpoint", async (_label, overrides) => {
    expect(await sendError(oauthMailbox(overrides))).toEqual({ outcome: "failed", mailboxIssue: true });
    expect(oauth.refreshGoogle).not.toHaveBeenCalled();
    expect(oauth.refreshMicrosoft).not.toHaveBeenCalled();
  });
});
