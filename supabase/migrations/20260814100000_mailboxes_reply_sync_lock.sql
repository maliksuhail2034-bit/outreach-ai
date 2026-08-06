-- Reliability Track item 6: reply-sync overlap protection.
--
-- runReplySyncWorker() (lib/email/reply-worker.ts) previously selected every
-- eligible mailbox via a plain `select` (listMailboxesForReplySync) with no
-- claim/lease of any kind, unlike the send and verification pipelines
-- (campaign_leads.locked_until / claim_due_sends, leads.verification_locked
-- _until / claim_due_verifications). A slow run still in flight when the
-- next scheduled sync-replies invocation fires could process the same
-- mailbox's inbox twice concurrently and race on its own cursor advance
-- (updateMailboxSyncCursor's plain update). This adds the same lease pattern
-- the other two pipelines already use, scoped only to mailboxes/reply-sync —
-- it does not touch campaign_leads, send_attempts, or claim_due_sends() at
-- all.

alter table public.mailboxes
  add column reply_sync_locked_until timestamptz;

comment on column public.mailboxes.reply_sync_locked_until is 'Claim lease set by claim_mailboxes_for_reply_sync() while a reply-sync run is in flight for this mailbox. Mirrors campaign_leads.locked_until / leads.verification_locked_until.';

-- Mirrors claim_due_sends()/claim_due_verifications(): atomic row-level
-- claim via `for update skip locked` so an overlapping sync-replies
-- invocation can't process the same mailbox's inbox twice concurrently. No
-- daily-limit/suppression logic needed here, same reasoning as
-- claim_due_verifications() — reply sync has no per-day cap.
create or replace function public.claim_mailboxes_for_reply_sync()
returns setof public.mailboxes
language plpgsql
as $$
begin
  return query
  with candidates as (
    select id
    from public.mailboxes
    where status = 'active'
      and imap_enabled = true
      and (reply_sync_locked_until is null or reply_sync_locked_until < now())
    for update skip locked
  )
  update public.mailboxes
  set reply_sync_locked_until = now() + interval '10 minutes'
  where id in (select id from candidates)
  returning *;
end;
$$;
