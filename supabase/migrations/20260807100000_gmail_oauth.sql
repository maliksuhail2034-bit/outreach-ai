-- Google Workspace / Gmail Integration: lets a mailbox be connected via
-- Google OAuth instead of a manually-entered SMTP/IMAP password. Purely
-- additive — every existing row keeps its exact current behavior
-- (email_provider defaults to 'smtp', which is what every row already is).
--
-- Gmail is not a new provider pipeline: smtp.gmail.com/imap.gmail.com
-- accept OAuth2/XOAUTH2 auth over the same real SMTP/IMAP protocol
-- lib/email/providers/smtp.ts and lib/email/reply-providers/imap.ts already
-- speak (see lib/email/get-provider.ts / get-reply-provider.ts). Those two
-- classes gain an in-place auth-resolution branch on the columns added
-- here; no new EmailProvider/ReplyProvider implementation, no new factory
-- branch, no new business logic.

-- The send-side seam, symmetric to reply_provider below (which already
-- anticipated this — see its original comment in
-- 20260731100000_mailboxes_imap.sql: "a future Gmail API / Microsoft Graph
-- implementation will branch on ... widening the check constraint is how a
-- second provider gets added later, not a schema rewrite").
alter table public.mailboxes
  add column email_provider text not null default 'smtp'
    constraint mailboxes_email_provider_check check (email_provider in ('smtp', 'gmail'));

comment on column public.mailboxes.email_provider is 'Which auth strategy lib/email/providers/smtp.ts uses to send: ''smtp'' decrypts encrypted_smtp_password as today; ''gmail'' refreshes encrypted_google_refresh_token into an OAuth2 access token against smtp.gmail.com. Always ''smtp'' for a manually-connected mailbox.';

-- Widen reply_provider exactly as its own comment already said this would
-- happen — no rewrite, just the second value.
alter table public.mailboxes drop constraint mailboxes_reply_provider_check;
alter table public.mailboxes add constraint mailboxes_reply_provider_check
  check (reply_provider in ('imap', 'gmail'));

-- 'disconnected' is a deliberate user action (Disconnect Google in
-- /mailboxes), distinct from 'error' (something went wrong) and 'paused'
-- (temporarily not sending, credentials still valid, one click to resume).
-- claim_due_sends() and listMailboxesForReplySync() already filter on
-- status = 'active', so moving a mailbox to any non-active status
-- (including this new one) is sufficient on its own to stop both sending
-- and reply-sync from touching it — no extra guard needed in either
-- worker or provider class.
alter table public.mailboxes drop constraint mailboxes_status_check;
alter table public.mailboxes add constraint mailboxes_status_check
  check (status in ('active', 'paused', 'error', 'disconnected'));

-- A Gmail-connected mailbox has no SMTP password at all — relax the
-- not-null constraint, but still require a password for every 'smtp' row
-- via an explicit check instead of silently allowing a null password
-- anywhere.
alter table public.mailboxes alter column encrypted_smtp_password drop not null;
alter table public.mailboxes add constraint mailboxes_smtp_password_required_check
  check (email_provider = 'gmail' or encrypted_smtp_password is not null);

-- Only the refresh token is ever persisted (never the short-lived access
-- token) — lib/email/google-oauth.ts refreshes a fresh access token
-- on-demand for every send/reply-sync, the same "decrypt fresh on every
-- use" pattern encrypted_smtp_password already follows. Encrypted with the
-- exact same AES-256-GCM scheme and MAILBOX_ENCRYPTION_KEY as
-- encrypted_smtp_password/encrypted_imap_password (lib/crypto/smtp-secret.ts,
-- reused as-is) — a Google refresh token is the same kind of secret
-- (this mailbox's send/receive credential), same blast-radius domain.
alter table public.mailboxes add column encrypted_google_refresh_token text;

comment on column public.mailboxes.encrypted_google_refresh_token is 'AES-256-GCM ciphertext (lib/crypto/smtp-secret.ts, same key as encrypted_smtp_password). Null unless email_provider = ''gmail''. Never exposed to clients — see lib/db/mailboxes.ts''s omitPassword().';
