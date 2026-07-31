import nodemailer from "nodemailer";

import { decryptSmtpPassword } from "@/lib/crypto/smtp-secret";
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

// Classifies a thrown nodemailer/SMTP error into retry / bounced / failed —
// see EmailSendError in ../provider.ts for what each means. Connection-level
// failures and SMTP 4xx are transient ("retry"); SMTP 5xx splits into a
// recipient-address rejection ("bounced") or any other permanent failure
// ("failed"). An error shape we don't recognize defaults to "retry" rather
// than silently treating it as terminal.
function classifySmtpError(error: unknown): EmailSendError {
  const err = error as { responseCode?: number; code?: string; message?: string; response?: string };
  const message = err.message ?? "SMTP send failed.";

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

// Sends exactly one email over SMTP using a single mailbox's credentials.
// No retries, no batching, no connection reuse across calls — a fresh
// transport per send, matching the "send one message" scope of this class.
export class SmtpEmailProvider implements EmailProvider {
  constructor(private readonly mailbox: Mailbox) {}

  async send(message: OutboundEmailMessage): Promise<SendResult> {
    const password = decryptSmtpPassword(this.mailbox.encrypted_smtp_password);

    const transporter = nodemailer.createTransport({
      host: this.mailbox.smtp_host,
      port: this.mailbox.smtp_port,
      secure: this.mailbox.smtp_port === 465,
      requireTLS: this.mailbox.smtp_port !== 465,
      auth: {
        user: this.mailbox.smtp_username,
        pass: password,
      },
    });

    try {
      const info = await transporter.sendMail({
        from: formatAddress(message.from),
        to: formatAddress(message.to),
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });

      return { providerMessageId: info.messageId };
    } catch (error) {
      throw classifySmtpError(error);
    }
  }
}
