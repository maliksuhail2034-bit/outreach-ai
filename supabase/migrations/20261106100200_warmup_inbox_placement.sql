-- Warmup inbox placement + spam rescue.
--
-- Until now the warmup engine only ever looked at the recipient mailbox's
-- INBOX, so a warmup email that a provider filed as spam was never seen:
-- never replied to, never pulled back out of spam, and never counted. That
-- spam signal is the core of what warmup exists to fix, and what customers
-- judge a warmup tool by ("inbox placement %").
--
-- lib/warmup/inbox-agent.ts now records, per warmup message, where it
-- landed in the recipient's mailbox and whether it was rescued from spam.
-- The daily stats roll that up into warmup_stats.spam_rate (an existing
-- column that had no producer) plus the raw counts below.

alter table public.warmup_messages
  add column placement text
    constraint warmup_messages_placement_check check (placement in ('inbox', 'spam')),
  add column placement_checked_at timestamptz,
  add column rescued_at timestamptz;

comment on column public.warmup_messages.placement is 'Where the recipient mailbox''s IMAP view first found this message: ''inbox'' or ''spam''. Null until found (not yet delivered, or the recipient has IMAP disabled).';
comment on column public.warmup_messages.rescued_at is 'When the recipient''s inbox agent moved this message from spam back to the inbox (a "not spam" signal to the provider). Null if it was never in spam.';

-- The inbox agent's per-cycle lookup: this mailbox's recent warmup mail
-- whose placement isn't known yet.
create index warmup_messages_to_mailbox_unplaced_idx
  on public.warmup_messages (to_mailbox_id, sent_at)
  where placement is null;

alter table public.warmup_stats
  add column inbox_count integer not null default 0,
  add column spam_count integer not null default 0;

comment on column public.warmup_stats.inbox_count is 'Warmup emails sent by this profile on stat_date that were found in the recipient''s inbox.';
comment on column public.warmup_stats.spam_count is 'Warmup emails sent by this profile on stat_date that were found in the recipient''s spam folder (and rescued).';
