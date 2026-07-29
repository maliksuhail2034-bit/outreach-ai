-- One row per user: account-wide sending preferences.

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  signature text,
  unsubscribe_text text,
  tracking_enabled boolean not null default true,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_user_id_key unique (user_id)
);

comment on table public.settings is 'Account-wide sending preferences, one row per user.';

alter table public.settings enable row level security;

create policy settings_select_own on public.settings
  for select using (auth.uid() = user_id);

create policy settings_insert_own on public.settings
  for insert with check (auth.uid() = user_id);

create policy settings_update_own on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy settings_delete_own on public.settings
  for delete using (auth.uid() = user_id);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();
