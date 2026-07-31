-- Organization/workspace foundation. Additive only: every existing table
-- keeps its direct user_id column and RLS exactly as-is (see CLAUDE.md §7
-- and the account CLAUDE.md's "no redesign" instruction) — nothing here
-- retrofits campaigns/leads/mailboxes/etc. This just gives future features
-- (billing, team seats) a real organization to attach to instead of a
-- direct auth.users reference, without changing anything about how the
-- product behaves today. For now: one user = exactly one organization,
-- created lazily (see getOrCreateOrganizationForUser in
-- lib/db/organizations.ts) the same way campaigns lazily get a default
-- sequence — there's no trigger on auth.users, matching every other
-- user-owned table in this schema (profiles, settings, etc.), none of
-- which auto-provision on signup either.
--
-- Both tables are created up front, before either one's RLS policies —
-- organizations' own select policy is membership-based and needs
-- organization_members to already exist.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'A workspace. One per user for now (no invites/seats yet) — see organization_members.';

create index organizations_owner_user_id_idx on public.organizations (owner_user_id);

-- Join table: who belongs to which organization. Kept separate from
-- organizations.owner_user_id (rather than inferring membership from
-- ownership) specifically so future multi-member support is a data change,
-- not another schema migration + RLS rewrite. No `role` column yet — every
-- row today is the org's owner and nothing reads or writes a role, so
-- adding one now would be speculative; it's a trivial additive migration
-- whenever seats/roles actually ship.

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_org_user_key unique (organization_id, user_id)
);

comment on table public.organization_members is 'Which users belong to which organization. Exactly one row (the owner) per organization for now.';

create index organization_members_user_id_idx on public.organization_members (user_id);

alter table public.organizations enable row level security;

-- Select is membership-based (not owner_user_id directly) so this doesn't
-- need another RLS migration the day a second member type exists.
create policy organizations_select_member on public.organizations
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id and m.user_id = auth.uid()
    )
  );

create policy organizations_insert_own on public.organizations
  for insert with check (auth.uid() = owner_user_id);

create policy organizations_update_own on public.organizations
  for update using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create policy organizations_delete_own on public.organizations
  for delete using (auth.uid() = owner_user_id);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organization_members enable row level security;

create policy organization_members_select on public.organization_members
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id and o.owner_user_id = auth.uid()
    )
  );

-- Only the org's own owner can add a membership row, and only for
-- themselves — there's no invite flow yet, so this is intentionally not a
-- general "owner can add anyone" policy.
create policy organization_members_insert_self on public.organization_members
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id and o.owner_user_id = auth.uid()
    )
  );

-- No update/delete policy: nothing on this row is mutable (no role column)
-- and member removal is explicitly out of scope for this task — same
-- "add the policy when a real caller needs it" reasoning as send_attempts'
-- missing insert/delete policies (20260730100030_send_attempts.sql).

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- Backfill: every existing user gets a personal organization + owner
-- membership, so nothing about their current access changes post-migration
-- (requirement: existing users keep working normally). Idempotent — safe
-- to re-run.
insert into public.organizations (owner_user_id, name)
select u.id, coalesce(nullif(split_part(u.email, '@', 1), ''), 'My') || '''s workspace'
from auth.users u
where not exists (
  select 1 from public.organizations o where o.owner_user_id = u.id
);

insert into public.organization_members (organization_id, user_id)
select o.id, o.owner_user_id
from public.organizations o
where not exists (
  select 1 from public.organization_members m
  where m.organization_id = o.id and m.user_id = o.owner_user_id
);
