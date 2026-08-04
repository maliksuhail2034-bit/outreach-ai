// Microsoft's fixed connection endpoints — the same real SMTP/IMAP servers
// any mail client uses (Microsoft 365 and consumer Outlook.com alike share
// these), just authenticated with OAuth2/XOAUTH2 instead of a password. No
// per-mailbox variation, unlike a custom domain's SMTP/IMAP host — so these
// are constants, not columns. Mirrors google-constants.ts exactly.
export const OUTLOOK_SMTP_HOST = "smtp.office365.com";
export const OUTLOOK_SMTP_PORT = 587;
export const OUTLOOK_IMAP_HOST = "outlook.office365.com";
export const OUTLOOK_IMAP_PORT = 993;

// This app authenticates directly against smtp.office365.com/
// outlook.office365.com via XOAUTH2 (see providers/smtp.ts,
// reply-providers/imap.ts) rather than calling Microsoft Graph — mirrors
// the Gmail integration's reasoning exactly (see google-constants.ts).
// IMAP.AccessAsUser.All/SMTP.Send are Microsoft's documented delegated
// scopes for OAuth2 over IMAP/SMTP AUTH (not Graph mail scopes), confirmed
// current for both Microsoft 365 and Outlook.com as of this integration
// (see Microsoft Learn: "Authenticate an IMAP, POP or SMTP connection using
// OAuth"). offline_access is required to receive a refresh token. openid +
// email are requested so the connected account's address can be read
// straight off the returned id_token's `email` claim — no Graph call needed
// just to identify which account connected.
export const MICROSOFT_OAUTH_SCOPES = [
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
  "offline_access",
  "openid",
  "email",
] as const;
