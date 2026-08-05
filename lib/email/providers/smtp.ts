import nodemailer from "nodemailer";

import { decryptSmtpPassword } from "@/lib/crypto/smtp-secret";
import { GoogleOAuthError, refreshGoogleAccessToken } from "@/lib/email/google-oauth";
import { GMAIL_SMTP_HOST, GMAIL_SMTP_PORT } from "@/lib/email/google-constants";
import { MicrosoftOAuthError, refreshMicrosoftAccessToken } from "@/lib/email/microsoft-oauth";
import { OUTLOOK_SMTP_HOST, OUTLOOK_SMTP_PORT } from "@/lib/email/microsoft-constants";
import { normalizeMessageId } from "@/lib/email/message-id";
import type { Tables } from "@/types/database.types";
import { EmailSendError, type EmailProvider, type OutboundEmailMessage, type SendResult } from "../provider";

// Typed as the full row (not MailboxSafe) so this can only be constructed
// with a mailbox fetched via getMailboxCredentials() — the type system
// enforces that the caller couldn't have obtained this from a user-facing
// read path, since MailboxSafe omits encrypted_smtp_password entirely.
type Mailbox = Tables<"mailboxes">;

function formatAddress(address: { name?: string; email: string }): string {
  return address.name ? `"${address.name}" <${address.email}>` : address.email;
}

// SMTP reply codes that unambiguously mean "this specific mailbox doesn't
// exist" rather than some other permanent rejection (auth failure, policy
// block, malformed message). 550/551/553/554 are the standard "no such
// user"/"relaying denied"/"transaction failed" codes recipient servers use
// for a bad address — see RFC 5321 §4.2.3. Deliberately narrow: an
// unrecognized 5xx stays "failed", never "bounced", since a wrong bounce
// classification permanently suppresses a possibly-good address (see the
// Sending Engine plan's Risks section).
const BOUNCE_RESPONSE_CODES = new Set([550, 551, 553, 554]);
const BOUNCE_TEXT_PATTERN = /user unknown|mailbox (not found|unavailable)|no such user|recipient (rejected|not found)/i;

// Nodemailer's own defaults are generous (2min connect / 30s greeting /
// 10min socket) — fine in isolation, but a single unreachable/hung mailbox
// would otherwise block send-worker.ts for minutes per email with no upper
// bound, and leave the mailbox form's "Test connection" button spinning far
// past its own 10s Promise.race (see TEST_CONNECTION_TIMEOUT_MS in
// app/(app)/mailboxes/actions.ts). Bounding all three here, at the one spot
// both send() and verifySmtpConnection() build their transport, keeps both
// paths predictable without touching either caller (E4).
const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
};

// Nodemailer surfaces every connect/greeting/socket timeout as `code:
// "ETIMEDOUT"` with an internal message ("Connection timeout" / "Greeting
// never received" / "Timeout") that means nothing to an end user — replace
// it with one clear message before it reaches classifySmtpError below or
// verifySmtpConnection()'s plain throw.
function friendlySmtpTimeoutMessage(error: unknown): string | null {
  const err = error as { code?: string };
  if (err?.code === "ETIMEDOUT") {
    return "Couldn't reach the mail server in time. Check the host and port, then try again.";
  }
  return null;
}

// Classifies a thrown nodemailer/SMTP error into retry / bounced / failed —
// see EmailSendError in ../provider.ts for what each means. Connection-level
// failures and SMTP 4xx are transient ("retry"); SMTP 5xx splits into a
// recipient-address rejection ("bounced") or any other permanent failure
// ("failed"). An error shape we don't recognize defaults to "retry" rather
// than silently treating it as terminal.
function classifySmtpError(error: unknown): EmailSendError {
  const err = error as { responseCode?: number; code?: string; message?: string; response?: string };
  const message = friendlySmtpTimeoutMessage(error) ?? err.message ?? "SMTP send failed.";

  const transientCodes = new Set(["ECONNECTION", "ETIMEDOUT", "ECONNREFUSED", "ESOCKET", "EDNS", "ETLS"]);
  if (err.code && transientCodes.has(err.code)) {
    return new EmailSendError(message, "retry");
  }

  if (typeof err.responseCode === "number") {
    if (err.responseCode >= 400 && err.responseCode < 500) {
      return new EmailSendError(message, "retry");
    }
    if (err.responseCode >= 500) {
      const responseText = `${err.response ?? ""} ${message}`;
      const looksLikeBounce = BOUNCE_RESPONSE_CODES.has(err.responseCode) || BOUNCE_TEXT_PATTERN.test(responseText);
      return new EmailSendError(message, looksLikeBounce ? "bounced" : "failed");
    }
  }

  return new EmailSendError(message, "retry");
}

// Resolves the connection details nodemailer needs — real SMTP either way,
// just a different auth strategy. A Gmail- or Outlook-connected mailbox
// (email_provider = 'gmail'/'outlook', see the gmail_oauth/microsoft_oauth
// migrations) has no SMTP password to decrypt; each refreshes its own
// stored OAuth refresh token into a short-lived access token instead, fresh
// for every send (never cached), the same "resolve credentials on every
// use" pattern the password path already follows.
async function resolveSmtpConnection(mailbox: Mailbox) {
  if (mailbox.email_provider === "gmail") {
    if (!mailbox.encrypted_google_refresh_token) {
      throw new EmailSendError("This mailbox's Google connection is missing — reconnect it in Settings.", "failed");
    }
    const refreshToken = decryptSmtpPassword(mailbox.encrypted_google_refresh_token);
    let accessToken: string;
    try {
      accessToken = await refreshGoogleAccessToken(refreshToken);
    } catch (error) {
      // Translated into the same EmailSendError shape classifySmtpError
      // produces, so send-worker.ts's catch block classifies this exactly
      // like an SMTP-level auth failure — invalid_grant (Google revoked
      // access) maps to "failed" the same way a real SMTP 535 auth
      // rejection already would, not endlessly retried.
      if (error instanceof GoogleOAuthError) {
        throw new EmailSendError(error.message, error.outcome === "retry" ? "retry" : "failed");
      }
      throw error;
    }
    return {
      host: GMAIL_SMTP_HOST,
      port: GMAIL_SMTP_PORT,
      secure: false,
      requireTLS: true,
      auth: { type: "OAuth2" as const, user: mailbox.email, accessToken },
    };
  }

  // An Outlook-connected mailbox (email_provider = 'outlook', see the
  // microsoft_oauth migration) follows the exact same shape as the Gmail
  // branch above — smtp.office365.com accepts OAuth2/XOAUTH2 over the same
  // real SMTP protocol, just a different token issuer.
  if (mailbox.email_provider === "outlook") {
    if (!mailbox.encrypted_microsoft_refresh_token) {
      throw new EmailSendError("This mailbox's Microsoft connection is missing — reconnect it in Settings.", "failed");
    }
    const refreshToken = decryptSmtpPassword(mailbox.encrypted_microsoft_refresh_token);
    let accessToken: string;
    try {
      accessToken = await refreshMicrosoftAccessToken(refreshToken);
    } catch (error) {
      // Same translation as the Gmail branch: invalid_grant (Microsoft
      // revoked access) maps to "failed" the same way a real SMTP 535 auth
      // rejection already would, not endlessly retried.
      if (error instanceof MicrosoftOAuthError) {
        throw new EmailSendError(error.message, error.outcome === "retry" ? "retry" : "failed");
      }
      throw error;
    }
    return {
      host: OUTLOOK_SMTP_HOST,
      port: OUTLOOK_SMTP_PORT,
      secure: false,
      requireTLS: true,
      auth: { type: "OAuth2" as const, user: mailbox.email, accessToken },
    };
  }

  const password = decryptSmtpPassword(mailbox.encrypted_smtp_password ?? "");
  return {
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_port === 465,
    requireTLS: mailbox.smtp_port !== 465,
    auth: { user: mailbox.smtp_username, pass: password },
  };
}

// Sends exactly one email over SMTP using a single mailbox's credentials.
// No retries, no batching, no connection reuse across calls — a fresh
// transport per send, matching the "send one message" scope of this class.
export class SmtpEmailProvider implements EmailProvider {
  constructor(private readonly mailbox: Mailbox) {}

  async send(message: OutboundEmailMessage): Promise<SendResult> {
    const connection = await resolveSmtpConnection(this.mailbox);
    const transporter = nodemailer.createTransport({ ...connection, ...SMTP_TIMEOUTS });

    try {
      const info = await transporter.sendMail({
        from: formatAddress(message.from),
        to: formatAddress(message.to),
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });

      return { providerMessageId: normalizeMessageId(info.messageId) ?? info.messageId };
    } catch (error) {
      throw classifySmtpError(error);
    }
  }
}

// Verifies the connection/EHLO/AUTH handshake without sending a message —
// nodemailer's transporter.verify() does the same negotiation send() does up
// through authentication, then closes, never issuing MAIL FROM/RCPT TO/DATA.
// Used only by testSmtpConnectionAction (see app/(app)/mailboxes/actions.ts)
// for the mailbox form's "Test connection" button; send() above is
// completely unaffected — this is purely additive and reuses
// resolveSmtpConnection exactly as send() does, so it exercises the same
// Gmail/Outlook/manual auth branches a real send would.
export async function verifySmtpConnection(mailbox: Mailbox): Promise<void> {
  const connection = await resolveSmtpConnection(mailbox);
  const transporter = nodemailer.createTransport({ ...connection, ...SMTP_TIMEOUTS });
  try {
    await transporter.verify();
  } catch (error) {
    const friendlyMessage = friendlySmtpTimeoutMessage(error);
    if (friendlyMessage) throw new Error(friendlyMessage);
    throw error;
  }
}
