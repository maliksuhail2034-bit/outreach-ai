-- Append-mostly log of everything that happens to a sent email (sent,
-- delivered, opened, clicked, replied, bounced, unsubscribed, failed).
-- Ownership is derived from the parent campaign. Rows are typically
-- written by a trusted backend process (sending worker / provider webhook)
-- using the service-role client, which bypasses RLS by design — see
-- lib/supabase/admin.ts and CLAUDE.md §8.

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  mailbox_id uuid references public.mailboxes (id) on delete set null,
  event_type text not null
    constraint email_events_event_type_check
    check (event_type in ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'failed')),
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_events is 'Event log for sent emails: delivery/engagement/failure events per lead per campaign.';
comment on column public.email_events.provider_message_id is 'Message ID assigned by the sending provider, for correlating webhook callbacks.';

create index email_events_campaign_id_idx on public.email_events (campaign_id);
create index email_events_lead_id_idx on public.email_events (lead_id);
create index email_events_mailbox_id_idx on public.email_events (mailbox_id);
create index email_events_event_type_idx on public.email_events (event_type);
create index email_events_provider_message_id_idx on public.email_events (provider_message_id);

alter table public.email_events enable row level security;

create policy email_events_select_own on public.email_events
  for select using (
    exists (select 1 from public.campaigns c where c.id = email_events.campaign_id and c.user_id = auth.uid())
  );

create policy email_events_insert_own on public.email_events
  for insert with check (
    exists (select 1 from public.campaigns c where c.id = email_events.campaign_id and c.user_id = auth.uid())
  );

create policy email_events_update_own on public.email_events
  for update using (
    exists (select 1 from public.campaigns c where c.id = email_events.campaign_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.campaigns c where c.id = email_events.campaign_id and c.user_id = auth.uid())
  );

create policy email_events_delete_own on public.email_events
  for delete using (
    exists (select 1 from public.campaigns c where c.id = email_events.campaign_id and c.user_id = auth.uid())
  );

-- Defense in depth: the lead and mailbox referenced by an event must
-- belong to the same user as the campaign itself.
create or replace function public.check_email_event_owner()
returns trigger
language plpgsql
as $$
declare
  campaign_owner uuid;
begin
  select user_id into campaign_owner from public.campaigns where id = new.campaign_id;

  if campaign_owner is null then
    raise exception 'email_events.campaign_id must reference an existing campaign';
  end if;

  if not exists (
    select 1 from public.leads l where l.id = new.lead_id and l.user_id = campaign_owner
  ) then
    raise exception 'email_events.lead_id must reference a lead owned by the campaign owner';
  end if;

  if new.mailbox_id is not null and not exists (
    select 1 from public.mailboxes m where m.id = new.mailbox_id and m.user_id = campaign_owner
  ) then
    raise exception 'email_events.mailbox_id must reference a mailbox owned by the campaign owner';
  end if;

  return new;
end;
$$;

create trigger email_events_check_owner
  before insert or update on public.email_events
  for each row execute function public.check_email_event_owner();

create trigger email_events_set_updated_at
  before update on public.email_events
  for each row execute function public.set_updated_at();
