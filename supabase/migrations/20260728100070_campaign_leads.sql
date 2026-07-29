-- Join table: which leads are enrolled in which campaign, and which
-- mailbox is sending to them. Ownership is derived from the parent
-- campaign, not stored directly on this table.

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  mailbox_id uuid references public.mailboxes (id) on delete set null,
  status text not null default 'pending'
    constraint campaign_leads_status_check
    check (status in ('pending', 'active', 'replied', 'bounced', 'unsubscribed', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_leads_campaign_lead_key unique (campaign_id, lead_id)
);

comment on table public.campaign_leads is 'Enrollment of a lead into a campaign, and the mailbox sending to them.';

create index campaign_leads_campaign_id_idx on public.campaign_leads (campaign_id);
create index campaign_leads_lead_id_idx on public.campaign_leads (lead_id);
create index campaign_leads_mailbox_id_idx on public.campaign_leads (mailbox_id);
create index campaign_leads_status_idx on public.campaign_leads (status);

alter table public.campaign_leads enable row level security;

create policy campaign_leads_select_own on public.campaign_leads
  for select using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_leads.campaign_id and c.user_id = auth.uid()
    )
  );

create policy campaign_leads_insert_own on public.campaign_leads
  for insert with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_leads.campaign_id and c.user_id = auth.uid()
    )
  );

create policy campaign_leads_update_own on public.campaign_leads
  for update using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_leads.campaign_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_leads.campaign_id and c.user_id = auth.uid()
    )
  );

create policy campaign_leads_delete_own on public.campaign_leads
  for delete using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_leads.campaign_id and c.user_id = auth.uid()
    )
  );

-- Defense in depth: the lead and mailbox attached to a campaign must belong
-- to the same user as the campaign itself, preventing cross-user mixing.
create or replace function public.check_campaign_lead_owner()
returns trigger
language plpgsql
as $$
declare
  campaign_owner uuid;
begin
  select user_id into campaign_owner from public.campaigns where id = new.campaign_id;

  if campaign_owner is null then
    raise exception 'campaign_leads.campaign_id must reference an existing campaign';
  end if;

  if not exists (
    select 1 from public.leads l where l.id = new.lead_id and l.user_id = campaign_owner
  ) then
    raise exception 'campaign_leads.lead_id must reference a lead owned by the campaign owner';
  end if;

  if new.mailbox_id is not null and not exists (
    select 1 from public.mailboxes m where m.id = new.mailbox_id and m.user_id = campaign_owner
  ) then
    raise exception 'campaign_leads.mailbox_id must reference a mailbox owned by the campaign owner';
  end if;

  return new;
end;
$$;

create trigger campaign_leads_check_owner
  before insert or update on public.campaign_leads
  for each row execute function public.check_campaign_lead_owner();

create trigger campaign_leads_set_updated_at
  before update on public.campaign_leads
  for each row execute function public.set_updated_at();
