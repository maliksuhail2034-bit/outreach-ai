-- Reusable message templates a user can pull into sequence steps.

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  subject text,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.templates is 'Reusable message templates owned by a user.';

create index templates_user_id_idx on public.templates (user_id);

alter table public.templates enable row level security;

create policy templates_select_own on public.templates
  for select using (auth.uid() = user_id);

create policy templates_insert_own on public.templates
  for insert with check (auth.uid() = user_id);

create policy templates_update_own on public.templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy templates_delete_own on public.templates
  for delete using (auth.uid() = user_id);

create trigger templates_set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();
