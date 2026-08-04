-- Microsoft 365 / Outlook Integration: lets a mailbox be connected via
-- Microsoft OAuth instead of a manually-entered SMTP/IMAP password. Purely
-- additive — every existing row keeps its exact current behavior
-- (email_provider/reply_provider default to 'smtp'/'imap', unchanged).
--
-- Same shape as 20260807100000_gmail_oauth.sql, and the same non-Graph
-- reasoning: smtp.office365.com/outlook.office365.com accept OAuth2/XOAUTH2
-- auth over the same real SMTP/IMAP protocol lib/email/providers/smtp.ts and
-- lib/email/reply-providers/imap.ts already speak (see
-- lib/email/get-provider.ts / get-reply-provider.ts). Those two classes gain
-- another in-place auth-resolution branch on the columns widened/added here
-- — no new EmailProvider/ReplyProvider implementation, no new factory
-- branch, no new business logic.

alter table public.mailboxes drop constraint mailboxes_email_provider_check;
alter table public.mailboxes add constraint mailboxes_email_provider_check
  check (email_provider in ('smtp', 'gmail', 'outlook'));

alter table public.mailboxes drop constraint mailboxes_reply_provider_check;
alter table public.mailboxes add constraint mailboxes_reply_provider_check
  check (reply_provider in ('imap', 'gmail', 'outlook'));

-- A Microsoft-connected mailbox has no SMTP password either, same as a
-- Gmail-connected one — widen the existing check rather than replacing it.
alter table public.mailboxes drop constraint mailboxes_smtp_password_required_check;
alter table public.mailboxes add constraint mailboxes_smtp_password_required_check
  check (email_provider in ('gmail', 'outlook') or encrypted_smtp_password is not null);

-- Only the refresh token is ever persisted (never the short-lived access
-- token) — lib/email/microsoft-oauth.ts refreshes a fresh access token
-- on-demand for every send/reply-sync, the same "decrypt fresh on every
-- use" pattern encrypted_smtp_password/encrypted_google_refresh_token
-- already follow. Encrypted with the exact same AES-256-GCM scheme and
-- MAILBOX_ENCRYPTION_KEY as the other two encrypted credential columns
-- (lib/crypto/smtp-secret.ts, reused as-is) — a Microsoft refresh token is
-- the same kind of secret (this mailbox's own send/receive credential), no
-- new encryption key.
alter table public.mailboxes add column encrypted_microsoft_refresh_token text;

comment on column public.mailboxes.encrypted_microsoft_refresh_token is 'AES-256-GCM ciphertext (lib/crypto/smtp-secret.ts, same key as encrypted_smtp_password). Null unless email_provider = ''outlook''. Never exposed to clients — see lib/db/mailboxes.ts''s omitPassword().';

comment on column public.mailboxes.email_provider is 'Which auth strategy lib/email/providers/smtp.ts uses to send: ''smtp'' decrypts encrypted_smtp_password as today; ''gmail''/''outlook'' each refresh their own encrypted refresh token into an OAuth2 access token against their provider''s SMTP host. Always ''smtp'' for a manually-connected mailbox.';
