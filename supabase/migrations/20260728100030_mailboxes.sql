-- Sending mailboxes (SMTP accounts) a user sends campaigns from.
--
-- `encrypted_smtp_password` must hold ciphertext produced by the
-- application layer (never plaintext) and must never be selected on any
-- code path that can reach a browser. See lib/db/mailboxes.ts, which
-- excludes it from all reads except the trusted sending-worker path.

create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  email text not null,
  display_name text,
  smtp_host text not null,
  smtp_port integer not null default 587,
  smtp_username text not null,
  encrypted_smtp_password text not null,
  daily_limit integer not null default 50
    constraint mailboxes_daily_limit_check check (daily_limit > 0),
  warmup_enabled boolean not null default false,
  status text not null default 'active'
    constraint mailboxes_status_check check (status in ('active', 'paused', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailboxes_user_email_key unique (user_id, email)
);

comment on table public.mailboxes is 'SMTP sending accounts owned by a user, optionally linked to a verified domain.';
comment on column public.mailboxes.encrypted_smtp_password is 'Ciphertext only, encrypted at the application layer. Never expose to clients.';

create index mailboxes_user_id_idx on public.mailboxes (user_id);
create index mailboxes_domain_id_idx on public.mailboxes (domain_id);
create index mailboxes_status_idx on public.mailboxes (status);

alter table public.mailboxes enable row level security;

create policy mailboxes_select_own on public.mailboxes
  for select using (auth.uid() = user_id);

create policy mailboxes_insert_own on public.mailboxes
  for insert with check (auth.uid() = user_id);

create policy mailboxes_update_own on public.mailboxes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy mailboxes_delete_own on public.mailboxes
  for delete using (auth.uid() = user_id);

-- Defense in depth: a mailbox's domain must belong to the same user, even
-- though RLS on both tables already prevents a user from referencing rows
-- they can't see.
create or replace function public.check_mailbox_domain_owner()
returns trigger
language plpgsql
as $$
begin
  if new.domain_id is not null and not exists (
    select 1 from public.domains d where d.id = new.domain_id and d.user_id = new.user_id
  ) then
    raise exception 'mailboxes.domain_id must reference a domain owned by the same user';
  end if;
  return new;
end;
$$;

create trigger mailboxes_check_domain_owner
  before insert or update on public.mailboxes
  for each row execute function public.check_mailbox_domain_owner();

create trigger mailboxes_set_updated_at
  before update on public.mailboxes
  for each row execute function public.set_updated_at();
