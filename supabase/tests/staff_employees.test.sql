-- Tests for staff usernames, password-policy fields and work sessions
-- (supabase/migrations/20261109100000_staff_employees.sql).
-- Run against the LOCAL stack only: `supabase test db`. One transaction,
-- rolled back.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

create temp table fx (name text primary key, id uuid not null);

do $$
declare v_user uuid := gen_random_uuid(); v_staff uuid;
begin
  insert into auth.users (id, email) values (v_user, 'emp@staff-employees-test.invalid');
  insert into public.staff_members (user_id, role, display_name, username)
  values (v_user, 'sales', 'Emp Loyee', 'emp.loyee') returning id into v_staff;
  insert into fx values ('user', v_user), ('staff', v_staff);
end $$;

-- Usernames -------------------------------------------------------------------------
select is((select password_policy_version from public.staff_members where id = (select id from fx where name = 'staff')), 0::smallint,
  'new accounts start below the staff password policy');
select is((select password_must_change from public.staff_members where id = (select id from fx where name = 'staff')), false,
  'must-change defaults to false (the app sets it for new invites)');
select throws_ok(
  $$insert into public.staff_members (user_id, role, display_name, username)
    select id, 'sales', 'Dup', 'EMP.LOYEE' from auth.users where email = 'emp@staff-employees-test.invalid'$$,
  '23514', null, 'usernames must be stored lowercase');
do $$ begin insert into auth.users (id, email) values (gen_random_uuid(), 'emp2@staff-employees-test.invalid'); end $$;
select throws_ok(
  $$insert into public.staff_members (user_id, role, display_name, username)
    select id, 'sales', 'Dup', 'emp.loyee' from auth.users where email = 'emp2@staff-employees-test.invalid'$$,
  '23505', null, 'usernames are unique');
select throws_ok(
  $$update public.staff_members set username = 'jane@acme.com' where id = (select id from fx where name = 'staff')$$,
  '23514', null, 'a username can never be an email address');
select throws_ok(
  $$update public.staff_members set username = 'ab' where id = (select id from fx where name = 'staff')$$,
  '23514', null, 'usernames are at least 3 characters');

-- Work sessions -------------------------------------------------------------------------
select lives_ok($$select public.staff_touch_work_session((select id from fx where name = 'staff'), 'IN')$$, 'first activity opens a session');
select public.staff_touch_work_session((select id from fx where name = 'staff'), 'IN');
select is((select count(*)::int from public.staff_work_sessions where staff_id = (select id from fx where name = 'staff')), 1,
  'activity within 15 minutes extends the same session');

-- Make the open session look 20 minutes idle, then act again.
update public.staff_work_sessions
set started_at = now() - interval '50 minutes', last_activity_at = now() - interval '20 minutes'
where staff_id = (select id from fx where name = 'staff');
select public.staff_touch_work_session((select id from fx where name = 'staff'), null);
select is((select count(*)::int from public.staff_work_sessions where staff_id = (select id from fx where name = 'staff')), 2,
  'activity after 15 idle minutes starts a new session');
select is(
  (select end_reason from public.staff_work_sessions where staff_id = (select id from fx where name = 'staff') and ended_at is not null),
  'idle', 'the stale session is closed as idle');
select ok(
  (select ended_at = last_activity_at from public.staff_work_sessions where staff_id = (select id from fx where name = 'staff') and ended_at is not null),
  'an idle session ends at its last activity, not when it was noticed');
select is(
  (select seconds from public.staff_work_seconds(now() - interval '1 day') where staff_id = (select id from fx where name = 'staff')),
  1800::bigint, 'work seconds sum closed and open sessions (30 min + ~0)');

select public.staff_end_work_session((select id from fx where name = 'staff'), 'signed_out');
select is((select count(*)::int from public.staff_work_sessions where staff_id = (select id from fx where name = 'staff') and ended_at is null), 0,
  'signing out closes the open session');
select throws_ok(
  $$insert into public.staff_work_sessions (staff_id, end_reason) values ((select id from fx where name = 'staff'), 'coffee')$$,
  '23514', null, 'end reasons are a fixed list');

-- Privileges ------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'public.staff_work_sessions'::regclass), true, 'RLS is enabled on work sessions');
select ok(
  not has_table_privilege('authenticated', 'public.staff_work_sessions', 'select')
  and not has_table_privilege('anon', 'public.staff_work_sessions', 'select')
  and has_table_privilege('service_role', 'public.staff_work_sessions', 'select, insert, update'),
  'only the service role can read or write work sessions');
select ok(
  not has_function_privilege('authenticated', 'public.staff_touch_work_session(uuid, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.staff_work_seconds(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.staff_touch_work_session(uuid, text, integer)', 'execute'),
  'only the service role can record or read work time');

select ok(
  not has_function_privilege('authenticated', 'public.users_with_verified_mfa(uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.users_with_verified_mfa(uuid[])', 'execute'),
  'only the service role can ask who has 2-step login');
select is_empty(
  $$select public.users_with_verified_mfa(array[(select id from fx where name = 'user')])$$,
  'a user without a verified factor is not listed');

select * from finish();
rollback;
