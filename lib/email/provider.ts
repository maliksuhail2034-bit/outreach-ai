// Provider-agnostic contract for actually sending an email. Exactly one
// implementation exists today (SmtpEmailProvider) — this interface exists so
// a second provider (SES, Resend, SendGrid, Mailgun, etc.) can be added
// later without touching any call site that only depends on this file.

export interface OutboundEmailMessage {
  from: { name?: string; email: string };
  to: { name?: string; email: string };
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendResult {
  providerMessageId: string;
}

// Thrown by any EmailProvider implementation on failure. `retryable`
// classifies the failure (connection-level / SMTP 4xx vs SMTP 5xx, or their
// equivalents for a future provider) so a caller can decide whether to back
// off and retry — this class only carries that classification, it never
// retries anything itself.
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

export interface EmailProvider {
  send(message: OutboundEmailMessage): Promise<SendResult>;
}
