-- Tests for the staff console and verified-lead pool
-- (supabase/migrations/20261107100000_staff_console.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- One transaction, rolled back. Fixtures are created as postgres; API-role
-- checks run as `authenticated` with a user's JWT claims, as PostgREST would.
--
-- Not covered here: the pg_cron schedule (monitoring_jobs_cron.test.sql),
-- the send path's real-address resolution (lib/email/send-worker-verified-
-- lead.test.ts) and the app-side permission model (vitest).

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(32);

-- Fixtures ------------------------------------------------------------------
create temp table fx (name text primary key, id uuid not null);
grant select on fx to authenticated, anon;

do $$
declare v_user uuid; v_org uuid; v_name text;
begin
  foreach v_name in array array['a', 'b', 'c', 'd', 'e'] loop
    v_user := gen_random_uuid();
    insert into auth.users (id, email) values (v_user, v_name || '@staff-console-test.invalid');
    insert into public.organizations (name, owner_user_id) values ('Org ' || v_name, v_user) returning id into v_org;
    insert into public.organization_members (organization_id, user_id) values (v_org, v_user);
    insert into fx values ('user_' || v_name, v_user), ('org_' || v_name, v_org);
  end loop;
end $$;

-- Org A already has its own lead at y@beta.test, so that pool lead must
-- never be delivered to A.
insert into public.leads (user_id, email) values ((select id from fx where name = 'user_a'), 'y@beta.test');

insert into public.verified_leads (email, first_name, company, source, verified_at)
values
  ('x@acme.test', 'Xena', 'Acme', 'staff-console-test', now()),
  ('y@beta.test', 'Yuri', 'Beta', 'staff-console-test', now()),
  ('z@gamma.test', 'Zoe', 'Gamma', 'staff-console-test', now());
insert into fx select 'vl_' || split_part(email, '@', 1), id from public.verified_leads where source = 'staff-console-test';

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where name = p_user), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.allocate(p_org text, p_quota int) returns int language sql as $$
  select public.allocate_verified_leads(
    (select id from fx where name = 'org_' || p_org), (select id from fx where name = 'user_' || p_org),
    '2026-11', 'starter', p_quota)
$$;

-- Lets the 30-day gap between deliveries pass.
create function pg_temp.age_deliveries() returns void language sql as $$
  update public.verified_leads set last_delivered_at = now() - interval '31 days'
  where source = 'staff-console-test' and last_delivered_at is not null
$$;

-- Structure -----------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.staff_members'::regclass, 'public.staff_audit_log'::regclass, 'public.ip_blocklist'::regclass,
    'public.auth_events'::regclass, 'public.grc_controls'::regclass, 'public.verified_lead_batches'::regclass,
    'public.verified_leads'::regclass, 'public.plan_lead_quotas'::regclass,
    'public.verified_lead_allocations'::regclass, 'public.verified_lead_deliveries'::regclass)),
  'RLS is enabled on every new table');
select is_empty(
  $$select 1 from pg_policies where schemaname = 'public' and tablename in (
    'staff_members', 'staff_audit_log', 'ip_blocklist', 'auth_events', 'grc_controls', 'verified_lead_batches',
    'verified_leads', 'plan_lead_quotas', 'verified_lead_deliveries')$$,
  'staff-only tables have no API policies at all');
select policies_are('public', 'verified_lead_allocations', array['verified_lead_allocations_select_member'],
  'customers can only read their own allocation summary');
select results_eq($$select plan_id, leads_per_month from public.plan_lead_quotas order by leads_per_month$$,
  $$values ('free', 0), ('starter', 100), ('growth', 300), ('pro', 1000), ('scale', 3000)$$,
  'plan quotas are seeded with the agreed starting values');

-- API roles can't reach the pool or the audit log ---------------------------
select pg_temp.act_as('user_a');
select throws_ok($$select 1 from public.verified_leads$$, '42501', null, 'a customer cannot read the verified-lead pool');
select throws_ok($$truncate public.verified_leads cascade$$, '42501', null, 'a customer cannot truncate the pool (RLS does not cover TRUNCATE)');
select throws_ok(
  $$insert into public.staff_audit_log (action) values ('forged')$$,
  '42501', null, 'a customer cannot write the staff audit log');
select throws_ok($$select pg_temp.allocate('a', 5)$$, '42501', null, 'a customer cannot run an allocation');
select throws_ok($$select * from public.staff_verify_audit_chain()$$, '42501', null, 'a customer cannot call the audit verifier');
reset role;

-- Audit log: hash chain, append-only -----------------------------------------
insert into public.staff_audit_log (actor_role, action, metadata) values ('owner', 'test.first', '{"n": 1}');
insert into public.staff_audit_log (actor_role, action, metadata) values ('owner', 'test.second', '{"n": 2}');
select ok(
  (select second.prev_hash = first.hash and length(second.hash) = 64
   from public.staff_audit_log first, public.staff_audit_log second
   where first.action = 'test.first' and second.action = 'test.second'),
  'each audit entry chains to the previous entry''s hash');
select is((select first_broken_seq from public.staff_verify_audit_chain()), null::bigint, 'the audit chain verifies');
select throws_ok($$update public.staff_audit_log set action = 'edited' where action = 'test.first'$$,
  'P0001', 'staff_audit_log is append-only', 'audit entries cannot be edited, even by postgres');
select throws_ok($$delete from public.staff_audit_log where action = 'test.first'$$,
  'P0001', 'staff_audit_log is append-only', 'audit entries cannot be deleted, even by postgres');

-- Allocation -------------------------------------------------------------------
select is(pg_temp.allocate('a', 5), 2, 'A gets every eligible lead except the one it already owns');
select is(
  (select array_agg(display_email order by display_email) from public.leads
   where user_id = (select id from fx where name = 'user_a') and verified_lead_id is not null),
  array['x••••@acme.test', 'z••••@gamma.test'],
  'delivered copies carry only the masked address for display');
select ok(
  (select bool_and(email = 'verified+' || verified_lead_id::text || '@leads.polimatiq.invalid') from public.leads
   where user_id = (select id from fx where name = 'user_a') and verified_lead_id is not null),
  'delivered copies hold a non-routable placeholder, never the real address');
select is(pg_temp.allocate('a', 5), 0, 're-running for the same month delivers nothing new');
select is(
  (select delivered_count from public.verified_lead_allocations where organization_id = (select id from fx where name = 'org_a')),
  2, 'the allocation record counts what was delivered');

select is(pg_temp.allocate('b', 5), 1, 'B only gets the lead not delivered in the last 30 days');
select pg_temp.age_deliveries();
select is(pg_temp.allocate('c', 5), 3, 'once 30 days pass every lead is eligible again');
select pg_temp.age_deliveries();
select is(pg_temp.allocate('d', 5), 3, 'D still gets every lead below 3 shares');
select pg_temp.age_deliveries();
select is(pg_temp.allocate('e', 5), 0, 'no lead goes to more than 3 customers');
select is((select max(times_delivered) from public.verified_leads where source = 'staff-console-test'), 3,
  'times_delivered tracks the share cap');
select is(pg_temp.allocate('a', 10), 0, 'a top-up never delivers the same lead to a customer twice');

select ok(
  has_table_privilege('service_role', 'public.verified_leads', 'select, insert, update, delete')
  and has_table_privilege('service_role', 'public.staff_audit_log', 'select, insert')
  and not has_table_privilege('service_role', 'public.staff_audit_log', 'update'),
  'the service role can work the pool and append to the audit log, never rewrite it');
select pg_temp.act_as('user_a');
select results_eq($$select delivered_count from public.verified_lead_allocations$$, array[2],
  'a customer sees only their own allocation summary');
reset role;

-- Customers can't repoint or unmask a delivered lead ---------------------------
select pg_temp.act_as('user_a');
select throws_ok(
  $$update public.leads set email = 'x@acme.test' where verified_lead_id = (select id from fx where name = 'vl_x')$$,
  '42501', null, 'a customer cannot change a delivered lead''s address');
select throws_ok(
  $$update public.leads set display_email = 'x@acme.test' where verified_lead_id = (select id from fx where name = 'vl_x')$$,
  '42501', null, 'a customer cannot change the masked address');
select throws_ok(
  $$insert into public.leads (user_id, email, verified_lead_id)
    values ((select id from fx where name = 'user_a'), 'me@own.test', (select id from fx where name = 'vl_y'))$$,
  '42501', null, 'a customer cannot link a lead to the pool');
select lives_ok(
  $$update public.leads set first_name = 'Renamed' where verified_lead_id = (select id from fx where name = 'vl_x')$$,
  'a customer can still edit the other fields of a delivered lead');
reset role;

-- Opt-outs through any customer pull a lead from the pool ----------------------
insert into public.suppressions (user_id, email, reason) values ((select id from fx where name = 'user_b'), 'Y@Beta.test', 'unsubscribed');
select is((select status from public.verified_leads where id = (select id from fx where name = 'vl_y')), 'suppressed',
  'an unsubscribe via any customer suppresses the pool lead for everyone');
insert into public.suppressions (user_id, email, reason) values ((select id from fx where name = 'user_b'), 'x@acme.test', 'manual');
select is((select status from public.verified_leads where id = (select id from fx where name = 'vl_x')), 'active',
  'a customer''s own manual suppression leaves the pool lead active');

select * from finish();
rollback;
