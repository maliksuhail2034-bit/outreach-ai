-- Reply tracking, Phase 1: IMAP polling credentials + sync cursor on
-- mailboxes, and the idempotency guarantee for recorded replies on
-- email_events. Purely additive — no existing column, constraint, or row is
-- changed, and nothing here is read by the send pipeline (claim_due_sends,
-- claim_send_attempt, record_send_success/failure) at all.

-- `reply_provider` is the seam a future Gmail API / Microsoft Graph
-- implementation will branch on (see lib/email/get-reply-provider.ts) — only
-- 'imap' is valid today; widening the check constraint is how a second
-- provider gets added later, not a schema rewrite.
alter table public.mailboxes
  add column reply_provider text not null default 'imap'
    constraint mailboxes_reply_provider_check check (reply_provider in ('imap')),
  add column imap_enabled boolean not null default false,
  add column imap_host text,
  add column imap_port integer not null default 993,
  add column imap_username text,
  add column encrypted_imap_password text,
  add column imap_uid_validity bigint,
  add column imap_last_uid bigint;

comment on column public.mailboxes.imap_enabled is 'Whether reply tracking is configured for this mailbox. A mailbox can send without it.';
comment on column public.mailboxes.encrypted_imap_password is 'Ciphertext only (same AES-256-GCM scheme as encrypted_smtp_password, see lib/crypto/smtp-secret.ts). Never expose to clients.';
comment on column public.mailboxes.imap_uid_validity is 'IMAP UIDVALIDITY for the folder being synced. Paired with imap_last_uid — if this changes, previously-stored UIDs are no longer meaningful and the worker must resync from the current highest UID.';
comment on column public.mailboxes.imap_last_uid is 'Sync cursor: highest IMAP UID already processed. Null means never synced — first sync starts from the mailbox''s current highest UID, never scanning history.';

-- The actual duplicate-reply guarantee (see lib/email/reply-worker.ts):
-- makes a second 'replied' row for the same inbound Message-ID a
-- constraint violation, not just something application code is expected to
-- avoid — same reasoning as send_attempts_lead_step_key for outbound sends.
-- Scoped to event_type = 'replied' only, so it has no effect on how 'sent'/
-- 'bounced'/other event types already use provider_message_id.
create unique index email_events_replied_message_id_key
  on public.email_events (provider_message_id)
  where event_type = 'replied' and provider_message_id is not null;
