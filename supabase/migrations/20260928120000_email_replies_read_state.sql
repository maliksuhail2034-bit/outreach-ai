-- Unified inbox (read UI): explicit grants on email_replies, and per-reply
-- read state.
--
-- 20260920100000_email_replies.sql granted nothing, so access depended on
-- each environment's default privileges: hosted projects grant ALL on new
-- public tables to the API roles, newer local images grant none (locally
-- service_role could not even SELECT or INSERT — the reply worker's own
-- write). The grants are stated explicitly here instead, same pattern as
-- lead_segments.
--
-- read_at is the only column a signed-in user may change. The column-level
-- UPDATE grant limits which columns; email_replies_update_own limits which
-- rows, with the same campaign-owner boundary as email_replies_select_own.
-- The table-wide revoke has to come first: a table-level UPDATE (the hosted
-- default) covers every column, so a column grant added on top of it would
-- restrict nothing. anon gets nothing, and authenticated no longer gets
-- INSERT/DELETE/TRUNCATE — only the reply-sync worker (service role) writes
-- rows. check_email_reply_owner still runs on every insert and update.

alter table public.email_replies add column read_at timestamptz;

comment on column public.email_replies.read_at is 'When the owner first opened this reply in the inbox (lib/db/email-replies.ts markEmailRepliesRead). Null = unread. The only column authenticated users may update.';

revoke all on table public.email_replies from anon, authenticated;
grant select on table public.email_replies to authenticated;
grant update (read_at) on table public.email_replies to authenticated;
grant select, insert on table public.email_replies to service_role;

create policy email_replies_update_own on public.email_replies
  for update
  using (
    exists (select 1 from public.campaigns c where c.id = email_replies.campaign_id and c.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.campaigns c where c.id = email_replies.campaign_id and c.user_id = auth.uid())
  );
