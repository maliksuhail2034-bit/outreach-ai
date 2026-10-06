-- Regression tests for database-level plan-limit enforcement
-- (supabase/migrations/20261002100000_plan_limit_enforcement.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- Same structure as send_now.test.sql: fixtures are committed up front
-- (dblink sessions only see committed rows) and created as postgres, which
-- the limit triggers exempt like any trusted session. Every attempt under
-- test runs in a separate dblink session under the real API role, with a
-- user JWT — exactly what a direct PostgREST call with the public anon key
-- and a user's own session token runs as. Fixtures are deleted at the end.
--
-- Not covered here: that the SQL limits/plan resolution match the app's
-- (lib/billing/plan-limit-enforcement.test.ts) and the send worker's use of
-- the usage counter (lib/billing/limits.test.ts).

set client_min_messages = warning;

-- Children first — see claim_due_sends.test.sql's cleanup note.
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@plan-limits-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@plan-limits-test.invalid');
delete from auth.users where email like '%@plan-limits-test.invalid';
drop schema if exists plan_limits_test cascade;
create schema plan_limits_test;

create table plan_limits_test.fx (name text primary key, id uuid not null);

create function plan_limits_test.id(p_name text) returns uuid
language sql stable as $$ select id from plan_limits_test.fx where name = p_name $$;

-- Waits (max 5s) until the dblink session with this application_name is
-- blocked waiting on a lock. Fails loudly instead of guessing with a sleep.
create function plan_limits_test.wait_until_blocked(p_app text) returns boolean
language plpgsql as $$
begin
  for i in 1..100 loop
    if exists (select 1 from pg_stat_activity where application_name = p_app and wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;

create function plan_limits_test.conn_str(p_app text) returns text
language plpgsql stable as $$
begin
  if inet_server_addr() is null then
    raise exception 'plan_limits tests must connect over TCP (run via `supabase test db`)';
  end if;
  return format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
    host(inet_server_addr()), inet_server_port(), current_database(), p_app);
end $$;

-- A user with their own organization (the app's lazy provisioning shape),
-- optionally with a subscription row.
create function plan_limits_test.add_user(p_name text, p_status text default null,
  p_period_end interval default null, p_plan text default 'starter') returns void
language plpgsql as $$
declare v_user uuid := gen_random_uuid(); v_org uuid;
begin
  insert into auth.users (id, email) values (v_user, p_name || '@plan-limits-test.invalid');
  insert into public.organizations (owner_user_id, name) values (v_user, p_name) returning id into v_org;
  insert into public.organization_members (organization_id, user_id) values (v_org, v_user);
  if p_status is not null then
    insert into public.subscriptions_v2 (organization_id, provider, provider_subscription_id, provider_plan_id,
      internal_plan_id, billing_interval, currency, provider_status, normalized_status, current_period_end)
    values (v_org, 'razorpay', 'sub_' || p_name, 'plan_' || p_name, p_plan, '1_month', 'INR', p_status, p_status,
      now() + p_period_end);
  end if;
  insert into plan_limits_test.fx values (p_name, v_user), (p_name || '_org', v_org);
end $$;

-- Insert statements as the app/PostgREST would send them.
create function plan_limits_test.mailbox_sql(p_user text, p_n int) returns text
language sql stable as $$
  select format('insert into public.mailboxes (user_id, email, smtp_host, smtp_username, encrypted_smtp_password) '
    'select %L, %L || g || ''@plan-limits-test.invalid'', ''smtp.invalid'', ''u'', ''x'' from generate_series(1, %s) g',
    plan_limits_test.id(p_user), p_user || '-mb-' || substr(md5(random()::text), 1, 8) || '-', p_n)
$$;

create function plan_limits_test.campaign_sql(p_user text, p_n int) returns text
language sql stable as $$
  select format('insert into public.campaigns (user_id, name) select %L, ''c'' || g from generate_series(1, %s) g',
    plan_limits_test.id(p_user), p_n)
$$;

create function plan_limits_test.lead_sql(p_user text, p_n int) returns text
language sql stable as $$
  select format('insert into public.leads (user_id, email) '
    'select %L, %L || g || ''@plan-limits-test.invalid'' from generate_series(1, %s) g',
    plan_limits_test.id(p_user), p_user || '-lead-' || substr(md5(random()::text), 1, 8) || '-', p_n)
$$;

create function plan_limits_test.count_rows(p_table text, p_user text) returns bigint
language plpgsql stable as $$
declare v bigint;
begin
  execute format('select count(*) from public.%I where user_id = $1', p_table) into v using plan_limits_test.id(p_user);
  return v;
end $$;

grant usage on schema plan_limits_test to authenticated, service_role;
grant select on plan_limits_test.fx to authenticated, service_role;
grant execute on all functions in schema plan_limits_test to authenticated, service_role;

do $fixtures$
declare
  v_internal uuid := '7ef89392-80ba-4447-a7b7-ba642ff00a53';
  v_user uuid; v_campaign uuid; v_mailbox uuid; v_lead uuid; v_sequence uuid; v_step uuid; v_cl uuid; v_attempt uuid;
begin
  perform plan_limits_test.add_user('free');
  perform plan_limits_test.add_user('free_bulk');
  perform plan_limits_test.add_user('paid', 'active', interval '20 days');
  perform plan_limits_test.add_user('grace', 'past_due', interval '-1 day');
  perform plan_limits_test.add_user('lapsed', 'past_due', interval '-4 days');
  perform plan_limits_test.add_user('cancelled', 'cancelled', interval '20 days');
  perform plan_limits_test.add_user('race');
  perform plan_limits_test.add_user('sender');
  perform plan_limits_test.add_user('nosy');

  -- A member of the internal unlimited workspace. Created owned by this
  -- user only if it doesn't exist locally; cleanup then cascades it away.
  v_user := gen_random_uuid();
  insert into auth.users (id, email) values (v_user, 'internal@plan-limits-test.invalid');
  insert into public.organizations (id, owner_user_id, name) values (v_internal, v_user, 'internal')
    on conflict (id) do nothing;
  insert into public.organization_members (organization_id, user_id) values (v_internal, v_user);
  insert into plan_limits_test.fx values ('internal', v_user);

  -- free_bulk sits one lead under the free limit (200).
  insert into public.leads (user_id, email)
  select plan_limits_test.id('free_bulk'), 'fb-' || g || '@plan-limits-test.invalid' from generate_series(1, 199) g;
  insert into public.leads (user_id, email) values (plan_limits_test.id('free_bulk'), 'existing@plan-limits-test.invalid')
    on conflict do nothing;
  delete from public.leads where user_id = plan_limits_test.id('free_bulk') and email = 'fb-199@plan-limits-test.invalid';

  -- sender: one claimed send in flight, as claim_send_attempt() leaves it.
  v_user := plan_limits_test.id('sender');
  insert into public.mailboxes (user_id, email, smtp_host, smtp_username, encrypted_smtp_password)
  values (v_user, 'sender-mb@plan-limits-test.invalid', 'smtp.invalid', 'u', 'x') returning id into v_mailbox;
  insert into public.campaigns (user_id, name, status) values (v_user, 'sender', 'active') returning id into v_campaign;
  insert into public.leads (user_id, email) values (v_user, 'sender-lead@plan-limits-test.invalid') returning id into v_lead;
  insert into public.sequences (campaign_id, name) values (v_campaign, 'sender') returning id into v_sequence;
  insert into public.sequence_steps (sequence_id, step_order) values (v_sequence, 0) returning id into v_step;
  insert into public.campaign_leads (campaign_id, lead_id, mailbox_id, status, current_step_id)
  values (v_campaign, v_lead, v_mailbox, 'active', v_step) returning id into v_cl;
  insert into public.send_attempts (campaign_lead_id, sequence_step_id, status, attempt_count, claimed_at)
  values (v_cl, v_step, 'pending', 1, now()) returning id into v_attempt;
  insert into plan_limits_test.fx values ('sender_campaign', v_campaign), ('sender_mailbox', v_mailbox),
    ('sender_lead', v_lead), ('sender_step', v_step), ('sender_cl', v_cl), ('sender_attempt', v_attempt);
end
$fixtures$;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

select plan(43);

do $$
declare
  v_session record;
begin
  for v_session in
    select * from (values ('free', 'authenticated'), ('free_bulk', 'authenticated'), ('paid', 'authenticated'),
      ('grace', 'authenticated'), ('lapsed', 'authenticated'), ('cancelled', 'authenticated'),
      ('internal', 'authenticated'), ('race_a', 'authenticated'), ('race_b', 'authenticated'),
      ('sender', 'authenticated'), ('nosy', 'authenticated'), ('worker', 'service_role')) s(name, role)
  loop
    perform dblink_connect(v_session.name, plan_limits_test.conn_str('plan_limits_test_' || v_session.name));
    perform dblink_exec(v_session.name, format('set role %I', v_session.role));
    perform dblink_exec(v_session.name, 'set statement_timeout = ''10s''');
    if v_session.role = 'authenticated' then
      perform dblink_exec(v_session.name, format('set request.jwt.claims = %L',
        json_build_object('sub', plan_limits_test.id(regexp_replace(v_session.name, '^race_[ab]$', 'race')),
          'role', 'authenticated')::text));
    end if;
  end loop;
end $$;

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'private.effective_plan_id(uuid)', 'execute'),
  'users cannot call the plan resolver');
select ok(not has_function_privilege('authenticated', 'private.enforce_plan_row_limit()', 'execute'),
  'users cannot call the limit trigger function');
select ok((select relrowsecurity from pg_class where oid = 'public.email_send_usage'::regclass),
  'email_send_usage has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.email_send_usage', 'insert')
  and not has_table_privilege('authenticated', 'public.email_send_usage', 'update')
  and not has_table_privilege('authenticated', 'public.email_send_usage', 'delete')
  and not has_table_privilege('authenticated', 'public.email_send_usage', 'truncate')
  and not has_table_privilege('anon', 'public.email_send_usage', 'insert'),
  'API roles have no write privileges on email_send_usage');
select ok(not exists (select 1 from pg_policy where polrelid = 'public.email_events'::regclass and polcmd = 'd'),
  'email_events has no delete policy');

-- Free plan: 1 mailbox, 1 campaign, 200 leads -------------------------------
select lives_ok(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.mailbox_sql('free', 1)),
  'free: the first mailbox is accepted');
select throws_like(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.mailbox_sql('free', 1)),
  '%Plan limit reached: your plan allows up to 1 mailboxes%', 'free: a second mailbox is rejected');
select is(plan_limits_test.count_rows('mailboxes', 'free'), 1::bigint, 'free: ...and not written');
select lives_ok(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.campaign_sql('free', 1)),
  'free: the first campaign is accepted');
select throws_like(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.campaign_sql('free', 1)),
  '%Plan limit reached: your plan allows up to 1 campaigns%', 'free: a second campaign is rejected');
select is(plan_limits_test.count_rows('campaigns', 'free'), 1::bigint, 'free: ...and not written');
select lives_ok(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.lead_sql('free', 200)),
  'free: a bulk insert reaching exactly 200 leads is accepted');
select throws_like(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.lead_sql('free', 1)),
  '%Plan limit reached: your plan allows up to 200 leads%', 'free: lead 201 is rejected');
select is(plan_limits_test.count_rows('leads', 'free'), 200::bigint, 'free: ...and not written');

-- A bulk insert that would cross the limit is rejected as a whole.
select is(plan_limits_test.count_rows('leads', 'free_bulk'), 199::bigint, 'free_bulk starts one under the limit');
select throws_like(format('select dblink_exec(%L, %L)', 'free_bulk', plan_limits_test.lead_sql('free_bulk', 2)),
  '%Plan limit reached%', 'a 2-row bulk insert crossing the limit is rejected');
select is(plan_limits_test.count_rows('leads', 'free_bulk'), 199::bigint, '...and neither row is written');
-- An insert that adds nothing (duplicate, ON CONFLICT DO NOTHING) is never
-- blocked, so reconnect/dedupe paths keep working at the limit.
select lives_ok(format('select dblink_exec(%L, %L)', 'free_bulk',
  format('insert into public.leads (user_id, email) values (%L, %L) on conflict do nothing',
    plan_limits_test.id('free_bulk'), 'existing@plan-limits-test.invalid')),
  'a no-op duplicate insert is not blocked');
select lives_ok(format('select dblink_exec(%L, %L)', 'free_bulk', plan_limits_test.lead_sql('free_bulk', 1)),
  'the 200th lead itself is accepted');

-- Paid / grace / lapsed / cancelled / internal -------------------------------
select lives_ok(format('select dblink_exec(%L, %L)', 'paid', plan_limits_test.mailbox_sql('paid', 3)),
  'active starter: 3 mailboxes are accepted');
select throws_like(format('select dblink_exec(%L, %L)', 'paid', plan_limits_test.mailbox_sql('paid', 1)),
  '%up to 3 mailboxes%', 'active starter: a 4th mailbox is rejected');
select lives_ok(format('select dblink_exec(%L, %L)', 'paid', plan_limits_test.lead_sql('paid', 500)),
  'active starter: 500 leads are accepted');
select lives_ok(format('select dblink_exec(%L, %L)', 'grace', plan_limits_test.mailbox_sql('grace', 2)),
  'past_due one day after period end (inside the 72h grace): starter limits apply');
select throws_like(format('select dblink_exec(%L, %L)', 'lapsed', plan_limits_test.mailbox_sql('lapsed', 2)),
  '%up to 1 mailboxes%', 'past_due four days after period end: back to free limits');
select throws_like(format('select dblink_exec(%L, %L)', 'cancelled', plan_limits_test.mailbox_sql('cancelled', 2)),
  '%up to 1 mailboxes%', 'cancelled subscription inside its period: free limits (same as the app)');
select lives_ok(format('select dblink_exec(%L, %L)', 'internal', plan_limits_test.campaign_sql('internal', 3)),
  'internal unlimited workspace: no campaign limit');
select lives_ok(format('select dblink_exec(%L, %L)', 'internal', plan_limits_test.mailbox_sql('internal', 2)),
  'internal unlimited workspace: no mailbox limit');

-- Trusted sessions (service role) are exempt.
select lives_ok(format('select dblink_exec(%L, %L)', 'worker', plan_limits_test.mailbox_sql('free', 1)),
  'service_role writes are not limited');
-- Ownership still comes from RLS: another user's id is refused outright.
select throws_like(format('select dblink_exec(%L, %L)', 'free', plan_limits_test.campaign_sql('paid', 1)),
  '%row-level security%', 'a user cannot insert rows owned by someone else');

-- Concurrency: two sessions racing for the last campaign slot ---------------
do $$ begin
  perform dblink_exec('race_a', 'begin');
  perform dblink_exec('race_a', plan_limits_test.campaign_sql('race', 1));
  perform dblink_send_query('race_b', plan_limits_test.campaign_sql('race', 1));
end $$;
select ok(plan_limits_test.wait_until_blocked('plan_limits_test_race_b'),
  'race: the second insert waits for the first one to finish');
do $$ begin perform dblink_exec('race_a', 'commit'); end $$;
select throws_like($$ select * from dblink_get_result('race_b') t(r text) $$,
  '%Plan limit reached%', 'race: ...and is rejected once the first commits');
do $$ begin perform * from dblink_get_result('race_b') t(r text); end $$;
select is(plan_limits_test.count_rows('campaigns', 'race'), 1::bigint, 'race: exactly one campaign exists');

-- Monthly email usage --------------------------------------------------------
select lives_ok(format('select * from dblink(%L, %L) t(r text)', 'worker',
  format('select public.record_send_success(%L, %L, %L, %L, %L, %L, %L, null, null)',
    plan_limits_test.id('sender_attempt'), plan_limits_test.id('sender_cl'), plan_limits_test.id('sender_campaign'),
    plan_limits_test.id('sender_lead'), plan_limits_test.id('sender_mailbox'), '<pl-test@plan-limits-test.invalid>',
    'completed') || '::text'),
  'the worker records a successful send');
select is((select sent_count from public.email_send_usage where user_id = plan_limits_test.id('sender')
    and month = date_trunc('month', now() at time zone 'utc')::date), 1,
  'a successful send increments the owner''s usage for the current UTC month');
select is((select n from dblink('sender',
    'select coalesce(sum(sent_count), 0)::int from public.email_send_usage') t(n int)), 1,
  'the owner can read their own usage');
select is((select n from dblink('nosy',
    'select count(*)::int from public.email_send_usage') t(n int)), 0,
  'another user cannot read it');
select throws_ok(format('select dblink_exec(%L, %L)', 'sender', 'update public.email_send_usage set sent_count = 0'),
  '42501', null, 'the owner cannot reset their usage');
select throws_ok(format('select dblink_exec(%L, %L)', 'sender', 'delete from public.email_send_usage'),
  '42501', null, 'the owner cannot delete their usage');
select throws_ok(format('select dblink_exec(%L, %L)', 'sender',
  format('insert into public.email_send_usage (user_id, month, sent_count) values (%L, date_trunc(''month'', now())::date, -5)',
    plan_limits_test.id('sender'))),
  '42501', null, 'the owner cannot write usage rows');
select is((select n from dblink('sender', 'with d as (delete from public.email_events returning 1) select count(*)::int from d') t(n int)), 0,
  'the owner cannot delete their email_events directly');
select lives_ok(format('select dblink_exec(%L, %L)', 'sender',
  format('delete from public.campaigns where id = %L', plan_limits_test.id('sender_campaign'))),
  'the owner can still delete their campaign (cascading its events and send attempts)');
select is((select count(*) from public.send_attempts where id = plan_limits_test.id('sender_attempt')), 0::bigint,
  '...which removes the send attempt');
select is((select sent_count from public.email_send_usage where user_id = plan_limits_test.id('sender')
    and month = date_trunc('month', now() at time zone 'utc')::date), 1,
  '...but not the recorded usage');

-- ---------------------------------------------------------------------------
select * from finish();

do $$ begin
  perform dblink_disconnect(name) from unnest(array['free', 'free_bulk', 'paid', 'grace', 'lapsed', 'cancelled',
    'internal', 'race_a', 'race_b', 'sender', 'nosy', 'worker']) name;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Cleanup (committed fixtures). Children first, then deleting the users
-- cascades the rest they own: organizations, subscriptions, usage rows.
-- ---------------------------------------------------------------------------
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@plan-limits-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@plan-limits-test.invalid');
delete from auth.users where email like '%@plan-limits-test.invalid';
drop schema plan_limits_test cascade;
