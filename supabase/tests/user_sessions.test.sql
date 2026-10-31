-- Regression tests for list_my_sessions() / revoke_my_session()
-- (supabase/migrations/20261031100000_user_sessions.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- No concurrency involved, so unlike the dblink-based tests everything runs
-- in one transaction that is rolled back. Calls run as the authenticated
-- API role with a user's JWT claims, what PostgREST runs them as.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-000000000001', 'owner@user-sessions-test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000002', 'other@user-sessions-test.invalid', 'authenticated', 'authenticated');

insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, not_after) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', now() - interval '2 days', now() - interval '2 days', 'laptop', null),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', now() - interval '1 day', now() - interval '1 hour', 'phone', null),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000001', now() - interval '3 days', now() - interval '3 days', 'expired', now() - interval '1 minute'),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000002', now(), now(), 'other-user', null);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-a000-000000000001',
  'role', 'authenticated',
  'session_id', '00000000-0000-4000-b000-000000000001')::text, true);

select results_eq(
  $$ select user_agent from public.list_my_sessions() $$,
  $$ values ('laptop'::text), ('phone'::text) $$,
  'lists only the caller''s unexpired sessions, the current one first'
);

select is(
  (select is_current from public.list_my_sessions() where user_agent = 'laptop'),
  true,
  'marks the session the caller''s JWT belongs to as current'
);

select is(
  (select is_current from public.list_my_sessions() where user_agent = 'phone'),
  false,
  'other sessions are not current'
);

select is(
  public.revoke_my_session('00000000-0000-4000-b000-000000000004'),
  false,
  'cannot revoke another user''s session'
);

select is(
  public.revoke_my_session('00000000-0000-4000-b000-000000000002'),
  true,
  'revokes one of the caller''s own sessions'
);

select results_eq(
  $$ select user_agent from public.list_my_sessions() $$,
  $$ values ('laptop'::text) $$,
  'a revoked session is no longer listed'
);

reset role;

select is(
  (select count(*)::int from auth.sessions where id = '00000000-0000-4000-b000-000000000004'),
  1,
  'the other user''s session is untouched'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.list_my_sessions() $$,
  '42501',
  null,
  'anon cannot list sessions'
);

select throws_ok(
  $$ select public.revoke_my_session('00000000-0000-4000-b000-000000000001') $$,
  '42501',
  null,
  'anon cannot revoke sessions'
);

reset role;

select is(
  (select count(*)::int from auth.sessions where user_id = '00000000-0000-4000-a000-000000000001'),
  2,
  'only the one revoked session was deleted'
);

select * from finish();
rollback;
