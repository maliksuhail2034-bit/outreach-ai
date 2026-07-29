-- Individual prospects. `custom_fields` holds arbitrary enrichment/CRM data
-- (e.g. AI qualification score, source, merge-tag values for personalization)
-- so the schema doesn't need a migration for every new field the product adds.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  list_id uuid references public.lead_lists (id) on delete set null,
  first_name text,
  last_name text,
  company text,
  title text,
  website text,
  linkedin text,
  email text not null,
  phone text,
  city text,
  country text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_user_email_key unique (user_id, email)
);

comment on table public.leads is 'Individual prospects owned by a user, optionally grouped into a lead list.';
comment on column public.leads.custom_fields is 'Arbitrary enrichment/CRM/personalization data as JSON.';

create index leads_user_id_idx on public.leads (user_id);
create index leads_list_id_idx on public.leads (list_id);
create index leads_email_idx on public.leads (email);
create index leads_custom_fields_gin_idx on public.leads using gin (custom_fields);

alter table public.leads enable row level security;

create policy leads_select_own on public.leads
  for select using (auth.uid() = user_id);

create policy leads_insert_own on public.leads
  for insert with check (auth.uid() = user_id);

create policy leads_update_own on public.leads
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy leads_delete_own on public.leads
  for delete using (auth.uid() = user_id);

-- Defense in depth: a lead's list must belong to the same user.
create or replace function public.check_lead_list_owner()
returns trigger
language plpgsql
as $$
begin
  if new.list_id is not null and not exists (
    select 1 from public.lead_lists l where l.id = new.list_id and l.user_id = new.user_id
  ) then
    raise exception 'leads.list_id must reference a lead_list owned by the same user';
  end if;
  return new;
end;
$$;

create trigger leads_check_list_owner
  before insert or update on public.leads
  for each row execute function public.check_lead_list_owner();

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();
