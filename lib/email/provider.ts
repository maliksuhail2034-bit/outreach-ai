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
  // Threading headers (RFC 5322 §3.6.4) — optional, and unused by the
  // campaign send pipeline (send-worker.ts never sets them), so campaign
  // sends are byte-for-byte unaffected. Added for the warmup engine's
  // auto-reply step (lib/warmup/warmup-worker.ts), which threads its
  // replies under the original warmup message.
  inReplyTo?: string;
  references?: string[];
  // Batch 3: PDF/image files attached to a sequence step (see
  // lib/email/attachment-validation.ts for the type/size limits already
  // enforced before content ever reaches here — this interface trusts its
  // caller the same way `html`/`text` already do). `content` is the actual
  // file bytes, already downloaded from Storage — never a path/URL, so no
  // EmailProvider implementation needs its own storage access.
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  // Campaign sends only: the RFC 8058 one-click unsubscribe URL (see
  // oneClickUnsubscribeUrl in lib/email/unsubscribe-token.ts). When set, the
  // provider adds List-Unsubscribe and List-Unsubscribe-Post headers for it.
  // Warmup sends never set it — they aren't mail to a prospect.
  listUnsubscribeUrl?: string;
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
//
// `mailboxIssue` is extra metadata on top of `outcome`, not a fourth
// outcome: true only when the failure is certainly about the sending
// mailbox's own credentials or sender identity (revoked OAuth, rejected
// SMTP AUTH, rejected MAIL FROM), so every send from it will fail the same
// way until the user fixes it. send-worker.ts uses it to move the mailbox
// to 'error' instead of failing lead after lead.
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "bounced" | "failed",
    public readonly mailboxIssue = false,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

export interface EmailProvider {
  send(message: OutboundEmailMessage): Promise<SendResult>;
}
