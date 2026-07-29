-- Named groupings of leads (e.g. an imported CSV, a saved segment).

create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lead_lists is 'Named groupings of leads owned by a user.';

create index lead_lists_user_id_idx on public.lead_lists (user_id);

alter table public.lead_lists enable row level security;

create policy lead_lists_select_own on public.lead_lists
  for select using (auth.uid() = user_id);

create policy lead_lists_insert_own on public.lead_lists
  for insert with check (auth.uid() = user_id);

create policy lead_lists_update_own on public.lead_lists
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy lead_lists_delete_own on public.lead_lists
  for delete using (auth.uid() = user_id);

create trigger lead_lists_set_updated_at
  before update on public.lead_lists
  for each row execute function public.set_updated_at();
