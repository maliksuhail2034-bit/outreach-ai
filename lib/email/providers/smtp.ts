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

// Classifies a thrown nodemailer/SMTP error into retryable vs terminal.
// Connection-level failures are transient; SMTP 5xx replies are permanent;
// SMTP 4xx replies are temporary. An error shape we don't recognize is
// treated as retryable rather than silently swallowed as terminal.
function classifySmtpError(error: unknown): EmailSendError {
  const err = error as { responseCode?: number; code?: string; message?: string };
  const message = err.message ?? "SMTP send failed.";

  const transientCodes = new Set(["ECONNECTION", "ETIMEDOUT", "ECONNREFUSED", "ESOCKET", "EDNS", "ETLS"]);
  if (err.code && transientCodes.has(err.code)) {
    return new EmailSendError(message, true);
  }

  if (typeof err.responseCode === "number") {
    return new EmailSendError(message, err.responseCode >= 400 && err.responseCode < 500);
  }

  return new EmailSendError(message, true);
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
