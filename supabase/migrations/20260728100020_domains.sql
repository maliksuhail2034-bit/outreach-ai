-- Sending domains a user has connected, with DNS verification state.

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  status text not null default 'pending'
    constraint domains_status_check check (status in ('pending', 'verified', 'failed')),
  spf_verified boolean not null default false,
  dkim_verified boolean not null default false,
  dmarc_verified boolean not null default false,
  tracking_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domains_user_domain_key unique (user_id, domain)
);

comment on table public.domains is 'Sending domains connected by a user, with SPF/DKIM/DMARC verification state.';

create index domains_user_id_idx on public.domains (user_id);
create index domains_status_idx on public.domains (status);

alter table public.domains enable row level security;

create policy domains_select_own on public.domains
  for select using (auth.uid() = user_id);

create policy domains_insert_own on public.domains
  for insert with check (auth.uid() = user_id);

create policy domains_update_own on public.domains
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy domains_delete_own on public.domains
  for delete using (auth.uid() = user_id);

create trigger domains_set_updated_at
  before update on public.domains
  for each row execute function public.set_updated_at();
