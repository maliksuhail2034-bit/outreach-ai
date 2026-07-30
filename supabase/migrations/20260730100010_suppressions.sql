-- Per-user, campaign-independent suppression list. A bounce or unsubscribe
-- on one campaign must block sends to that address from every other
-- campaign the same user runs, which per-enrollment campaign_leads.status
-- can't express on its own.

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  reason text not null
    constraint suppressions_reason_check check (reason in ('bounced', 'unsubscribed', 'manual')),
  source_campaign_id uuid references public.campaigns (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppressions_user_email_key unique (user_id, email)
);

comment on table public.suppressions is 'Addresses excluded from sending, campaign-independent, keyed by (user_id, email).';
comment on column public.suppressions.source_campaign_id is 'Informational only: which campaign triggered this suppression. Never used for scoping.';

create index suppressions_user_id_idx on public.suppressions (user_id);
create index suppressions_email_idx on public.suppressions (email);

alter table public.suppressions enable row level security;

create policy suppressions_select_own on public.suppressions
  for select using (auth.uid() = user_id);

create policy suppressions_insert_own on public.suppressions
  for insert with check (auth.uid() = user_id);

create policy suppressions_update_own on public.suppressions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy suppressions_delete_own on public.suppressions
  for delete using (auth.uid() = user_id);

create trigger suppressions_set_updated_at
  before update on public.suppressions
  for each row execute function public.set_updated_at();
