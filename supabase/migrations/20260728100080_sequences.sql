-- A named sequence of touches belonging to a campaign. Ownership is
-- derived from the parent campaign.

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sequences is 'A named sequence of outreach steps belonging to a campaign.';

create index sequences_campaign_id_idx on public.sequences (campaign_id);

alter table public.sequences enable row level security;

create policy sequences_select_own on public.sequences
  for select using (
    exists (select 1 from public.campaigns c where c.id = sequences.campaign_id and c.user_id = auth.uid())
  );

create policy sequences_insert_own on public.sequences
  for insert with check (
    exists (select 1 from public.campaigns c where c.id = sequences.campaign_id and c.user_id = auth.uid())
  );

create policy sequences_update_own on public.sequences
  for update using (
    exists (select 1 from public.campaigns c where c.id = sequences.campaign_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.campaigns c where c.id = sequences.campaign_id and c.user_id = auth.uid())
  );

create policy sequences_delete_own on public.sequences
  for delete using (
    exists (select 1 from public.campaigns c where c.id = sequences.campaign_id and c.user_id = auth.uid())
  );

create trigger sequences_set_updated_at
  before update on public.sequences
  for each row execute function public.set_updated_at();
