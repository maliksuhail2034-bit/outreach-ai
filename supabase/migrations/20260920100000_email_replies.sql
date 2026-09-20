-- Reply content persistence (Unified Inbox, persistence half only — see the
-- pre-launch audit's "Unified inbox/reply content persistence — NOT DONE").
-- email_events already records that a reply happened ('replied' event,
-- provider_message_id, matching metadata) but never the message itself —
-- lib/email/reply-providers/imap.ts parses the full body via mailparser and
-- discards it before returning ReplyMessage. This table is where that
-- content now lands. One row per matched reply, 1:1 with the email_events
-- row it corresponds to (see email_replies_email_event_id_key below) — no
-- inbox/read UI yet, that is a separate batch.
create table public.email_replies (
  id uuid primary key default gen_random_uuid(),
  email_event_id uuid not null references public.email_events (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  subject text,
  from_email text not null,
  from_name text,
  to_emails text[] not null default '{}',
  body_text text,
  body_html text,
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.email_replies is 'Persisted content (subject/from/to/body) for a matched inbound reply. Always paired 1:1 with the corresponding email_events "replied" row via email_event_id — that row remains the source of truth for whether/when a reply was recorded and matched.';
comment on column public.email_replies.email_event_id is 'The email_events "replied" row this content belongs to. Unique — see email_replies_email_event_id_key — one persisted reply per replied event, mirroring that event''s own provider_message_id idempotency guarantee.';
comment on column public.email_replies.campaign_id is 'Denormalized from the referenced email_events row (see check_email_reply_owner) so campaign-scoped queries and RLS don''t need to join through email_events.';
comment on column public.email_replies.lead_id is 'Denormalized from the referenced email_events row (see check_email_reply_owner).';
comment on column public.email_replies.mailbox_id is 'Denormalized from the referenced email_events row (see check_email_reply_owner). Not null: a persisted reply always came in through the mailbox that received it, unlike email_events.mailbox_id which is nullable for other event types.';
comment on column public.email_replies.received_at is 'The inbound message''s own Date header (ReplyMessage.receivedAt), not when this row was inserted — see created_at for that.';

-- One persisted reply per replied email_events row — mirrors that table's
-- own email_events_replied_message_id_key partial unique index. The reply
-- worker's insert must be written so a duplicate (same inbound Message-ID
-- reprocessed) never reaches this table a second time; this index is the
-- database-level backstop for that guarantee, not the only defense.
create unique index email_replies_email_event_id_key on public.email_replies (email_event_id);

create index email_replies_campaign_id_idx on public.email_replies (campaign_id);
create index email_replies_lead_id_idx on public.email_replies (lead_id);
create index email_replies_mailbox_id_idx on public.email_replies (mailbox_id);
create index email_replies_received_at_idx on public.email_replies (received_at desc);

alter table public.email_replies enable row level security;

-- Same shape as email_events_select_own — ownership is derived from the
-- parent campaign, not a user_id column on this table.
create policy email_replies_select_own on public.email_replies
  for select using (
    exists (select 1 from public.campaigns c where c.id = email_replies.campaign_id and c.user_id = auth.uid())
  );

-- No insert/update/delete policy for authenticated users: this table is
-- only ever written by the reply-sync worker (lib/email/reply-worker.ts)
-- under the service-role client (lib/supabase/admin.ts), which bypasses RLS
-- by design — same reasoning as email_events itself (see
-- 20260728100110_email_events.sql). Adding a broad user-facing write policy
-- here would be unused surface area, not a feature.

-- Defense in depth: campaign_id/lead_id/mailbox_id on this row must match
-- what the referenced email_events row itself already has, so this table
-- can never disagree with the event it's attached to (e.g. a bug passing
-- the wrong lead_id alongside a correct email_event_id). email_events'
-- own check_email_event_owner trigger already guarantees that row's
-- lead/mailbox belong to its campaign's owner, so re-deriving from it here
-- is enough — no need to re-walk the full ownership chain a second time.
create or replace function public.check_email_reply_owner()
returns trigger
language plpgsql
as $$
declare
  ev public.email_events%rowtype;
begin
  select * into ev from public.email_events where id = new.email_event_id;

  if ev.id is null then
    raise exception 'email_replies.email_event_id must reference an existing email_events row';
  end if;

  if ev.event_type is distinct from 'replied' then
    raise exception 'email_replies.email_event_id must reference an email_events row with event_type = replied';
  end if;

  if ev.campaign_id is distinct from new.campaign_id then
    raise exception 'email_replies.campaign_id must match the referenced email_events row''s campaign_id';
  end if;

  if ev.lead_id is distinct from new.lead_id then
    raise exception 'email_replies.lead_id must match the referenced email_events row''s lead_id';
  end if;

  if ev.mailbox_id is distinct from new.mailbox_id then
    raise exception 'email_replies.mailbox_id must match the referenced email_events row''s mailbox_id';
  end if;

  return new;
end;
$$;

create trigger email_replies_check_owner
  before insert or update on public.email_replies
  for each row execute function public.check_email_reply_owner();
