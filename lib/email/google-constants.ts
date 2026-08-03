// Gmail's fixed connection endpoints — the same real SMTP/IMAP servers any
// mail client uses, just authenticated with OAuth2/XOAUTH2 instead of a
// password. No per-mailbox variation, unlike a custom domain's SMTP/IMAP
// host — so these are constants, not columns.
export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GMAIL_SMTP_PORT = 587;
export const GMAIL_IMAP_HOST = "imap.gmail.com";
export const GMAIL_IMAP_PORT = 993;

// Least-privilege scopes: send-only for outgoing mail, read-only for reply
// detection — reply tracking never needs to modify/delete a message.
export const GMAIL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;
