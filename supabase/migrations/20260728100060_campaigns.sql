-- Outbound campaigns. `sending_window` holds schedule config (days, hours,
-- timezone) as JSON so scheduling rules can evolve without a migration.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  status text not null default 'draft'
    constraint campaigns_status_check check (status in ('draft', 'active', 'paused', 'completed')),
  sending_window jsonb not null default '{}'::jsonb,
  daily_limit integer not null default 50
    constraint campaigns_daily_limit_check check (daily_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.campaigns is 'Outbound campaigns owned by a user. Channel-agnostic: email today, other channels later.';
comment on column public.campaigns.sending_window is 'Schedule config as JSON: allowed days/hours/timezone.';

create index campaigns_user_id_idx on public.campaigns (user_id);
create index campaigns_status_idx on public.campaigns (status);

alter table public.campaigns enable row level security;

create policy campaigns_select_own on public.campaigns
  for select using (auth.uid() = user_id);

create policy campaigns_insert_own on public.campaigns
  for insert with check (auth.uid() = user_id);

create policy campaigns_update_own on public.campaigns
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy campaigns_delete_own on public.campaigns
  for delete using (auth.uid() = user_id);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();
