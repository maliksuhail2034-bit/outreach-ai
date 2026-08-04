// Gmail's fixed connection endpoints — the same real SMTP/IMAP servers any
// mail client uses, just authenticated with OAuth2/XOAUTH2 instead of a
// password. No per-mailbox variation, unlike a custom domain's SMTP/IMAP
// host — so these are constants, not columns.
export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GMAIL_SMTP_PORT = 587;
export const GMAIL_IMAP_HOST = "imap.gmail.com";
export const GMAIL_IMAP_PORT = 993;

// This app authenticates directly against smtp.gmail.com/imap.gmail.com via
// XOAUTH2 (see providers/smtp.ts, reply-providers/imap.ts) rather than
// calling the Gmail REST API, so the REST-only gmail.send/gmail.readonly
// scopes don't work here — Google's SMTP/IMAP servers only honor
// mail.google.com for XOAUTH2. userinfo.email is used once at connect time
// to populate mailboxes.email from Google's own response.
export const GMAIL_OAUTH_SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;
