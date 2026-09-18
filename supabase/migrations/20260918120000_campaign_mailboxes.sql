-- Pre-launch checklist item #6 (multi-mailbox pool / rotation), Batch 8.
-- A campaign's optional set of mailboxes to round-robin leads across at
-- enrollment time. Purely additive: campaigns.default_mailbox_id and every
-- existing single-mailbox behavior (claim_due_sends(), send-worker.ts,
-- readiness's per-lead resolution) is untouched — a campaign with no rows
-- here behaves exactly as it does today, falling back to default_mailbox_id.
-- Mirrors campaign_leads' exact shape/RLS/ownership-trigger pattern
-- (20260728100070_campaign_leads.sql): ownership derived through the parent
-- campaign, not stored directly on this table.

create table public.campaign_mailboxes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint campaign_mailboxes_campaign_mailbox_key unique (campaign_id, mailbox_id)
);

comment on table public.campaign_mailboxes is 'A campaign''s configured mailbox pool — leads are assigned round-robin across these at enrollment time (see lib/campaigns/readiness.ts''s resolvePoolMailboxId). No rows means the campaign uses campaigns.default_mailbox_id exactly as before this table existed.';

-- Deliberately on delete cascade (not set null, unlike campaign_leads.mailbox_id
-- / campaigns.default_mailbox_id): a null mailbox_id on a join row would be
-- meaningless — deleting the campaign or the mailbox should remove the pool
-- membership row itself, not leave a broken one behind.

create index campaign_mailboxes_campaign_id_idx on public.campaign_mailboxes (campaign_id);
create index campaign_mailboxes_mailbox_id_idx on public.campaign_mailboxes (mailbox_id);

alter table public.campaign_mailboxes enable row level security;

create policy campaign_mailboxes_select_own on public.campaign_mailboxes
  for select using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_mailboxes.campaign_id and c.user_id = auth.uid()
    )
  );

create policy campaign_mailboxes_insert_own on public.campaign_mailboxes
  for insert with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_mailboxes.campaign_id and c.user_id = auth.uid()
    )
  );

create policy campaign_mailboxes_delete_own on public.campaign_mailboxes
  for delete using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_mailboxes.campaign_id and c.user_id = auth.uid()
    )
  );

-- No update policy: membership is add/remove only (delete + re-insert),
-- same reasoning warmup_events' append-only shape already documents for
-- "no operation exists that would need one."

-- Defense in depth, same pattern as check_campaign_lead_owner /
-- check_campaign_default_mailbox_owner: the mailbox attached to a campaign's
-- pool must belong to the same user as the campaign, even though RLS on
-- both tables already prevents referencing rows the user can't see.
create or replace function public.check_campaign_mailbox_owner()
returns trigger
language plpgsql
as $$
declare
  campaign_owner uuid;
begin
  select user_id into campaign_owner from public.campaigns where id = new.campaign_id;

  if campaign_owner is null then
    raise exception 'campaign_mailboxes.campaign_id must reference an existing campaign';
  end if;

  if not exists (
    select 1 from public.mailboxes m where m.id = new.mailbox_id and m.user_id = campaign_owner
  ) then
    raise exception 'campaign_mailboxes.mailbox_id must reference a mailbox owned by the campaign owner';
  end if;

  return new;
end;
$$;

create trigger campaign_mailboxes_check_owner
  before insert on public.campaign_mailboxes
  for each row execute function public.check_campaign_mailbox_owner();
