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

// Thrown by any EmailProvider implementation on failure. `outcome`
// classifies the failure — the same three-value union
// record_send_failure() (supabase/migrations/20260730100030_send_attempts.sql)
// already accepts, so a caller can pass it straight through with no
// translation layer:
//   "retry"   — transient (connection-level, SMTP 4xx, or equivalent for a
//               future provider); safe to back off and retry.
//   "bounced" — the recipient address itself was rejected (e.g. SMTP 5xx
//               "user unknown"); should also suppress future sends to it.
//   "failed"  — terminal for a reason unrelated to the recipient (auth,
//               config, malformed message); never retried, never suppresses
//               the address.
// This class only carries the classification, it never retries or
// suppresses anything itself.
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "bounced" | "failed",
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

export interface EmailProvider {
  send(message: OutboundEmailMessage): Promise<SendResult>;
}
