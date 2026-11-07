-- Tests for auth_event_summary() (supabase/migrations/20261112100000_auth_event_summary.sql).
-- Run against the LOCAL stack only: `supabase test db`. One transaction,
-- rolled back. Events are dated in the far future so real rows never mix in.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

create temp table fx (name text primary key, id uuid not null);
do $$
declare v_staff uuid := gen_random_uuid(); v_customer uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_staff, 'staff@auth-summary-test.invalid'), (v_customer, 'cust@auth-summary-test.invalid');
  insert into public.staff_members (user_id, role, display_name, username) values (v_staff, 'security', 'Sec', 'sec.summary');
  insert into fx values ('staff', v_staff), ('customer', v_customer);
end $$;

-- 12 failures + 3 rate-limited from one address (same account), 1 failure
-- elsewhere; staff signs in from IN and US; the customer from IN and DE.
insert into public.auth_events (event_type, ip, email_hash, user_id, country, created_at)
select 'sign_in_failure', '203.0.113.7', repeat('a', 64), null, 'RU', '2099-01-01 10:00:00+00' from generate_series(1, 12);
insert into public.auth_events (event_type, ip, email_hash, user_id, country, created_at)
select 'sign_in_rate_limited', '203.0.113.7', repeat('a', 64), null, 'RU', '2099-01-01 10:05:00+00' from generate_series(1, 3);
insert into public.auth_events (event_type, ip, email_hash, user_id, country, created_at) values
  ('sign_in_failure', '198.51.100.2', repeat('b', 64), null, null, '2099-01-01 11:00:00+00'),
  ('sign_in_success', '198.51.100.3', null, (select id from fx where name = 'staff'), 'IN', '2099-01-01 09:00:00+00'),
  ('sign_in_success', '198.51.100.4', null, (select id from fx where name = 'staff'), 'US', '2099-01-01 12:00:00+00'),
  ('sign_in_success', '198.51.100.5', null, (select id from fx where name = 'customer'), 'IN', '2099-01-01 09:00:00+00'),
  ('sign_in_success', '198.51.100.6', null, (select id from fx where name = 'customer'), 'DE', '2099-01-01 12:00:00+00');

create temp table s as select public.auth_event_summary('2099-01-01 00:00:00+00') as j;

select is((select (j->>'successes')::int from s), 4, 'counts successes over the whole window');
select is((select (j->>'failures')::int from s), 13, 'counts failures');
select is((select (j->>'rate_limited')::int from s), 3, 'counts rate-limited attempts separately');
select is((select j->'by_ip'->0 from s), '{"ip": "203.0.113.7", "country": "RU", "refused": 15, "failures": 12}'::jsonb,
  'top address with failures and all refused attempts');
select is((select j->'by_account'->0 from s), '12'::jsonb, 'failures per account (hash never returned)');
select is(
  (select j->'staff_multi_country' from s),
  jsonb_build_array(jsonb_build_object('user_id', (select id from fx where name = 'staff'), 'countries', jsonb_build_array('IN', 'US'))),
  'flags only the staff account seen in two countries, not the customer');
select ok((select j->'countries' @> '[{"country": "Unknown", "refused": 1, "successes": 0}]'::jsonb from s), 'unlocated events are grouped as Unknown');
select ok((select not (j::text like '%' || repeat('a', 64) || '%') from s), 'no account hash leaves the function');
select ok(
  not has_function_privilege('authenticated', 'public.auth_event_summary(timestamptz, integer)', 'execute')
  and has_function_privilege('service_role', 'public.auth_event_summary(timestamptz, integer)', 'execute'),
  'only the service role can read the summary');

select * from finish();
rollback;
