// Normalized message shape every ReplyProvider implementation must produce
// (see the plan's normalization contract). Business logic — matching,
// idempotency, recording, all in lib/email/reply-worker.ts — only ever
// touches this type, never a provider-specific one (IMAP/MIME details,
// Gmail API JSON, Graph JSON, etc. never cross this boundary).
export interface ReplyMessage {
  // Normalized RFC822 Message-ID (angle brackets stripped, trimmed,
  // case preserved) — the idempotency identifier. Never synthesized: a
  // message with no Message-ID is skipped by the provider, not included
  // here with a made-up value.
  messageId: string;
  inReplyTo: string | null; // normalized, same rules as messageId
  references: string[]; // normalized, header order preserved
  from: { name?: string; email: string };
  to: { name?: string; email: string }[];
  subject: string | null;
  // Full text/HTML body, already parsed by the provider (e.g. mailparser) —
  // null when the message genuinely has no part of that type, not when
  // parsing fails (a parse failure is a thrown error upstream, same as a
  // missing Message-ID).
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string; // ISO timestamp
}

export interface SyncCursor {
  uidValidity: number;
  lastUid: number;
}

export interface FetchResult {
  messages: ReplyMessage[];
  cursor: SyncCursor;
}

// Mirrors EmailProvider's shape exactly: the mailbox (credentials, cursor)
// is constructor-injected by the implementation, not passed per call — see
// ImapReplyChecker and getReplyProvider().
export interface ReplyProvider {
  fetchNewMessages(): Promise<FetchResult>;
}
