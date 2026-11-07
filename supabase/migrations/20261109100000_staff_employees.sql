-- Employees: usernames, password policy tracking and work-time sessions for
-- staff accounts (owner / security / sales).
--
-- * username: what staff sign in with at /console/login. Independent of the
--   account's email, unique regardless of case, changeable by owner/security
--   (and by the person themselves) and recorded in the staff audit log.
-- * password_policy_version / password_must_change: owner and security
--   passwords must meet the staff policy (16+ characters, see
--   lib/staff/password-policy.ts). Existing accounts start at version 0, so
--   their next console visit asks for a compliant password. An owner or
--   security member who sets someone's password can require them to choose
--   their own at next sign-in.
-- * staff_work_sessions: time with the console open and in use. A session is
--   extended while the person is active and closed after 15 idle minutes or
--   at sign-out; "hours worked" is the sum of session durations.

alter table public.staff_members
  add column username text,
  add column password_policy_version smallint not null default 0,
  add column password_must_change boolean not null default false,
  add column password_changed_at timestamptz;

-- Existing accounts get a readable, unique starting username derived from
-- their name (e.g. "malik.suhail-3f9a"); it can be changed in the console.
update public.staff_members
set username = left(
    coalesce(nullif(trim(both '._-' from lower(regexp_replace(display_name, '[^A-Za-z0-9]+', '.', 'g'))), ''), 'staff'),
    24
  ) || '-' || substr(replace(id::text, '-', ''), 1, 4)
where username is null;

alter table public.staff_members
  alter column username set not null,
  add constraint staff_members_username_format
    check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

create unique index staff_members_username_key on public.staff_members (lower(username));

comment on column public.staff_members.username is 'Staff sign-in name for /console/login. Lowercase, 3-32 chars, independent of the account email; changeable (audited).';
comment on column public.staff_members.password_policy_version is '0 = not yet set under the staff password policy; 1 = set through the console under lib/staff/password-policy.ts.';
comment on column public.staff_members.password_must_change is 'Set when an owner/security member sets this person''s password: they must choose their own at next sign-in.';

create table public.staff_work_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members (id) on delete cascade,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
    constraint staff_work_sessions_end_reason_check check (end_reason is null or end_reason in ('idle', 'signed_out', 'access_changed')),
  country text
    constraint staff_work_sessions_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_work_sessions_order check (last_activity_at >= started_at and (ended_at is null or ended_at >= started_at))
);

comment on table public.staff_work_sessions is 'Staff time with the console open and in use. Extended while active, closed after 15 idle minutes or at sign-out. Service role only.';

create index staff_work_sessions_staff_started_idx on public.staff_work_sessions (staff_id, started_at desc);
create index staff_work_sessions_started_idx on public.staff_work_sessions (started_at);

alter table public.staff_work_sessions enable row level security;

create trigger staff_work_sessions_set_updated_at
  before update on public.staff_work_sessions
  for each row execute function public.set_updated_at();

-- Explicit privileges (see 20261107100000_staff_console.sql): no customer
-- access; the service role records and reads sessions.
revoke all on table public.staff_work_sessions from anon, authenticated, service_role;
grant select, insert, update, delete on table public.staff_work_sessions to service_role;

-- Records activity for one staff member: extends the open session, or closes
-- a stale one (idle) and opens a new one. Serialised per staff member so two
-- concurrent requests can't open two sessions.
create function public.staff_touch_work_session(p_staff_id uuid, p_country text default null, p_idle_minutes integer default 15)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.staff_work_sessions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('staff_work_session:' || p_staff_id::text, 0));

  select * into v_session from public.staff_work_sessions
  where staff_id = p_staff_id and ended_at is null
  order by started_at desc
  limit 1;

  if v_session.id is not null and v_session.last_activity_at > now() - make_interval(mins => p_idle_minutes) then
    update public.staff_work_sessions set last_activity_at = now() where id = v_session.id;
    return;
  end if;

  if v_session.id is not null then
    update public.staff_work_sessions
    set ended_at = v_session.last_activity_at, end_reason = 'idle'
    where id = v_session.id;
  end if;

  insert into public.staff_work_sessions (staff_id, country)
  values (p_staff_id, case when p_country ~ '^[A-Z]{2}$' then p_country end);
end;
$$;

-- Closes the open session (sign-out, or the account was blocked/deleted).
create function public.staff_end_work_session(p_staff_id uuid, p_reason text default 'signed_out')
returns void
language sql
security definer
set search_path = ''
as $$
  update public.staff_work_sessions
  set ended_at = greatest(last_activity_at, started_at), last_activity_at = greatest(last_activity_at, started_at), end_reason = p_reason
  where staff_id = p_staff_id and ended_at is null;
$$;

-- Seconds worked per staff member since a point in time (sessions that
-- started before it count only from it), for the Employees list.
create function public.staff_work_seconds(p_since timestamptz)
returns table (staff_id uuid, seconds bigint, sessions bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.staff_id,
    coalesce(sum(extract(epoch from (coalesce(s.ended_at, s.last_activity_at) - greatest(s.started_at, p_since))))::bigint, 0),
    count(*)
  from public.staff_work_sessions s
  where coalesce(s.ended_at, s.last_activity_at) > p_since
  group by s.staff_id;
$$;

revoke all on function public.staff_touch_work_session(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.staff_end_work_session(uuid, text) from public, anon, authenticated;
revoke all on function public.staff_work_seconds(timestamptz) from public, anon, authenticated;
grant execute on function public.staff_touch_work_session(uuid, text, integer) to service_role;
grant execute on function public.staff_end_work_session(uuid, text) to service_role;
grant execute on function public.staff_work_seconds(timestamptz) to service_role;

-- Which of these users have a verified 2-step factor. The Auth admin
-- list-users API doesn't include factors, so the console's Users and
-- Employees pages read it here. Service role only; returns ids, nothing else.
create function public.users_with_verified_mfa(p_user_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct f.user_id from auth.mfa_factors f
  where f.status = 'verified' and f.user_id = any (p_user_ids);
$$;

revoke all on function public.users_with_verified_mfa(uuid[]) from public, anon, authenticated;
grant execute on function public.users_with_verified_mfa(uuid[]) to service_role;
