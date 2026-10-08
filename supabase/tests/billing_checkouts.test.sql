-- Regression tests for the one-open-checkout-per-organization invariant and
-- its private claim tokens
-- (supabase/migrations/20261007100000_billing_checkouts.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- Same structure as plan_limits.test.sql: fixtures are committed up front
-- (dblink sessions only see committed rows). Every call under test runs in
-- its own dblink session under the real API role with a user JWT — what a
-- direct PostgREST call with a user's own session token runs as. "admin" is
-- a plain postgres session used only to arrange state (expire a checkout,
-- delete an organization); "worker" is the service role the webhook uses.
-- "teammate" is a second member of owner's organization: membership alone
-- must not let it attach or release a checkout someone else claimed.
--
-- Not covered here: the checkout action and webhook wiring
-- (app/(app)/billing/razorpay-actions.test.ts, app/api/webhooks/razorpay/route.test.ts).

set client_min_messages = warning;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

delete from auth.users where email like '%@billing-checkouts-test.invalid';
drop schema if exists billing_checkouts_test cascade;
create schema billing_checkouts_test;

create table billing_checkouts_test.fx (name text primary key, id uuid not null);
-- Claim tokens returned to the tests' own claims, by name.
create table billing_checkouts_test.tok (name text primary key, token text);

create function billing_checkouts_test.id(p_name text) returns uuid
language sql stable as $$ select id from billing_checkouts_test.fx where name = p_name $$;

create function billing_checkouts_test.tok(p_name text) returns text
language sql stable as $$ select token from billing_checkouts_test.tok where name = p_name $$;

create function billing_checkouts_test.wait_until_blocked(p_app text) returns boolean
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

create function billing_checkouts_test.conn_str(p_app text) returns text
language plpgsql stable as $$
begin
  if inet_server_addr() is null then
    raise exception 'billing_checkouts tests must connect over TCP (run via `supabase test db`)';
  end if;
  return format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
    host(inet_server_addr()), inet_server_port(), current_database(), p_app);
end $$;

-- A user who is the only member of their own organization.
create function billing_checkouts_test.add_user(p_name text) returns void
language plpgsql as $$
declare v_user uuid := gen_random_uuid(); v_org uuid;
begin
  insert into auth.users (id, email) values (v_user, p_name || '@billing-checkouts-test.invalid');
  insert into public.organizations (owner_user_id, name) values (v_user, p_name) returning id into v_org;
  insert into public.organization_members (organization_id, user_id) values (v_org, v_user);
  insert into billing_checkouts_test.fx values (p_name, v_user), (p_name || '_org', v_org);
end $$;

-- claim_billing_checkout as the given session; returns "outcome", plus
-- ":subscription_id" when one is attached and "#token" when a claim token
-- was returned (the token itself is not echoed).
create function billing_checkouts_test.claim(p_session text, p_org text, p_plan text default 'starter',
  p_interval text default '1_month', p_currency text default 'INR') returns text
language plpgsql as $$
declare v_result text;
begin
  select o || coalesce(':' || s, '') || case when t is not null then '#token' else '' end into v_result
  from extensions.dblink(p_session, format(
    'select claim_outcome, checkout_subscription_id, claim_token from public.claim_billing_checkout(%L, %L, %L, %L)',
    billing_checkouts_test.id(p_org), p_plan, p_interval, p_currency)) t(o text, s text, t text);
  return v_result;
end $$;

-- Claims as the given session and keeps the returned token under p_name.
create function billing_checkouts_test.claim_into(p_name text, p_session text, p_org text,
  p_plan text default 'starter') returns void
language plpgsql as $$
declare v_outcome text; v_token text;
begin
  select o, t into v_outcome, v_token
  from extensions.dblink(p_session, format(
    'select claim_outcome, claim_token from public.claim_billing_checkout(%L, %L, ''1_month'', ''INR'')',
    billing_checkouts_test.id(p_org), p_plan)) r(o text, t text);
  if v_outcome <> 'claimed' then
    raise exception 'expected a new claim, got %', v_outcome;
  end if;
  insert into billing_checkouts_test.tok values (p_name, v_token);
end $$;

-- The organization's open checkout id, read as postgres (bypasses RLS).
create function billing_checkouts_test.open_id(p_org text) returns uuid
language sql stable as $$
  select id from public.billing_checkouts
  where organization_id = billing_checkouts_test.id(p_org) and status = 'open'
$$;

create function billing_checkouts_test.open_count(p_org text) returns bigint
language sql stable as $$
  select count(*) from public.billing_checkouts
  where organization_id = billing_checkouts_test.id(p_org) and status = 'open'
$$;

create function billing_checkouts_test.call_bool(p_session text, p_sql text) returns boolean
language plpgsql as $$
declare v_result boolean;
begin
  select r into v_result from extensions.dblink(p_session, p_sql) t(r boolean);
  return v_result;
end $$;

create function billing_checkouts_test.attach(p_session text, p_checkout uuid, p_token text, p_sub text) returns boolean
language sql as $$
  select billing_checkouts_test.call_bool(p_session,
    format('select public.attach_billing_checkout_subscription(%L, %L, %L)', p_checkout, p_token, p_sub))
$$;

create function billing_checkouts_test.release(p_session text, p_checkout uuid, p_token text) returns boolean
language sql as $$
  select billing_checkouts_test.call_bool(p_session,
    format('select public.release_billing_checkout(%L, %L)', p_checkout, p_token))
$$;

-- Expires a checkout without claiming anything (as postgres).
create function billing_checkouts_test.expire(p_checkout uuid) returns void
language plpgsql as $$
begin
  perform extensions.dblink_exec('admin', format(
    'update public.billing_checkouts set expires_at = now() - interval ''1 second'' where id = %L', p_checkout));
end $$;

do $$ begin
  perform billing_checkouts_test.add_user('owner');
  perform billing_checkouts_test.add_user('teammate');
  perform billing_checkouts_test.add_user('nosy');
  perform billing_checkouts_test.add_user('fresh');
  perform billing_checkouts_test.add_user('race');
  perform billing_checkouts_test.add_user('doomed');
  insert into public.organization_members (organization_id, user_id)
  values (billing_checkouts_test.id('owner_org'), billing_checkouts_test.id('teammate'));
end $$;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
begin;
set search_path = public, extensions;

select plan(75);

do $$
declare
  v_session record;
begin
  for v_session in
    select * from (values ('owner', 'authenticated'), ('teammate', 'authenticated'), ('nosy', 'authenticated'),
      ('fresh', 'authenticated'), ('race_a', 'authenticated'), ('race_b', 'authenticated'),
      ('doomed', 'authenticated'), ('anon', 'anon'), ('worker', 'service_role'), ('admin', null)) s(name, role)
  loop
    perform dblink_connect(v_session.name, billing_checkouts_test.conn_str('billing_checkouts_test_' || v_session.name));
    perform dblink_exec(v_session.name, 'set statement_timeout = ''10s''');
    if v_session.role is not null then
      perform dblink_exec(v_session.name, format('set role %I', v_session.role));
    end if;
    if v_session.role = 'authenticated' then
      perform dblink_exec(v_session.name, format('set request.jwt.claims = %L',
        json_build_object('sub', billing_checkouts_test.id(regexp_replace(v_session.name, '^race_[ab]$', 'race')),
          'role', 'authenticated')::text));
    end if;
  end loop;
end $$;

-- Privileges / RLS -------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.billing_checkouts'::regclass),
  'billing_checkouts has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.billing_checkouts', 'insert')
  and not has_table_privilege('authenticated', 'public.billing_checkouts', 'update')
  and not has_table_privilege('authenticated', 'public.billing_checkouts', 'delete')
  and not has_table_privilege('anon', 'public.billing_checkouts', 'insert')
  and not has_table_privilege('anon', 'public.billing_checkouts', 'update'),
  'API roles have no write privileges on billing_checkouts');
select is((select array_agg(polcmd::text order by polcmd) from pg_policy where polrelid = 'public.billing_checkouts'::regclass),
  array['r'], 'billing_checkouts has only a select policy');
select ok(not has_function_privilege('anon', 'public.claim_billing_checkout(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.attach_billing_checkout_subscription(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.release_billing_checkout(uuid, text)', 'execute'),
  'anon cannot call the checkout functions');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
  from pg_proc p where p.oid in ('public.claim_billing_checkout(uuid, text, text, text)'::regprocedure,
    'public.attach_billing_checkout_subscription(uuid, text, text)'::regprocedure,
    'public.release_billing_checkout(uuid, text)'::regprocedure)),
  'checkout functions are security definer with an empty search_path');
select is((select count(*) from pg_proc where proname in ('attach_billing_checkout_subscription', 'release_billing_checkout')
  and pronamespace = 'public'::regnamespace), 2::bigint, 'no token-less attach/release overload exists');

select throws_like(
  format($q$ select dblink_exec('owner', 'insert into public.billing_checkouts (organization_id, provider, internal_plan_id, billing_interval, currency, expires_at) values (''%s'', ''razorpay'', ''starter'', ''1_month'', ''INR'', now() + interval ''1 day'')') $q$,
    billing_checkouts_test.id('owner_org')),
  '%permission denied%', 'a user cannot insert a checkout directly');
select throws_like(
  $q$ select * from dblink('anon', format('select claim_outcome from public.claim_billing_checkout(%L, ''starter'', ''1_month'', ''INR'')', billing_checkouts_test.id('owner_org'))) t(o text) $q$,
  '%permission denied%', 'an anonymous caller cannot claim a checkout');

-- First claim and its token ------------------------------------------------------
do $$ begin perform billing_checkouts_test.claim_into('owner1', 'owner', 'owner_org'); end $$;
select ok(billing_checkouts_test.tok('owner1') ~ '^[0-9a-f]{64}$', 'a new claim returns a 256-bit hex claim token');
select is((select claim_token_hash from public.billing_checkouts where id = billing_checkouts_test.open_id('owner_org')),
  extensions.digest(billing_checkouts_test.tok('owner1'), 'sha256'), 'only the SHA-256 hash of the token is stored');
select is((select position(billing_checkouts_test.tok('owner1') in row_to_json(bc)::text)
  from public.billing_checkouts bc where id = billing_checkouts_test.open_id('owner_org')), 0,
  'the raw token is stored nowhere in the row');
select is((select expires_at - created_at from public.billing_checkouts where id = billing_checkouts_test.open_id('owner_org')),
  interval '30 minutes', 'a new checkout expires 30 minutes after it is claimed');
select is(billing_checkouts_test.claim('owner', 'owner_org'), 'existing',
  'a second claim for the same offering reports the in-progress checkout, with no subscription id and no token');
select is(billing_checkouts_test.claim('teammate', 'owner_org'), 'existing',
  'another member of the organization gets no token for the in-progress checkout either');
select is(billing_checkouts_test.open_count('owner_org'), 1::bigint, 'still exactly one open checkout');

-- Token required: membership alone is not enough --------------------------------
select is(billing_checkouts_test.release('teammate', billing_checkouts_test.open_id('owner_org'), null), false,
  'a member cannot release a checkout they did not claim (no token)');
select is(billing_checkouts_test.release('teammate', billing_checkouts_test.open_id('owner_org'), repeat('0', 64)), false,
  'a member cannot release a checkout with a guessed token');
select is(billing_checkouts_test.release('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1') || 'x'), false,
  'a wrong token fails release, even for the member who claimed');
select is(billing_checkouts_test.attach('teammate', billing_checkouts_test.open_id('owner_org'), null, 'sub_fake'), false,
  'a member cannot attach a fake subscription to a checkout they did not claim (no token)');
select is(billing_checkouts_test.attach('teammate', billing_checkouts_test.open_id('owner_org'), repeat('f', 64), 'sub_fake'), false,
  'a member cannot attach with a guessed token');
select is(billing_checkouts_test.attach('nosy', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1'), 'sub_nosy'), false,
  'a non-member cannot attach even with the right token (membership is still required)');
select is(billing_checkouts_test.release('nosy', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1')), false,
  'a non-member cannot release even with the right token');
select is((select row(status, provider_subscription_id, claim_token_hash is not null)::text
  from public.billing_checkouts where id = billing_checkouts_test.open_id('owner_org')), '(open,,t)',
  'none of the refused calls changed the checkout');

-- Correct token: attach, then the token is spent -------------------------------
select is(billing_checkouts_test.attach('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1'), 'sub_owner_1'), true,
  'the claim token attaches the provider subscription id');
select is((select claim_token_hash from public.billing_checkouts where provider_subscription_id = 'sub_owner_1'), null::bytea,
  'attaching clears the stored token hash');
select is(billing_checkouts_test.attach('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1'), 'sub_overwrite'), false,
  'an attached provider id can never be overwritten, even with the original token');
select is(billing_checkouts_test.release('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1')), false,
  'a checkout with a provider subscription can never be released, even with the original token');
select is(billing_checkouts_test.claim('owner', 'owner_org'), 'existing:sub_owner_1',
  'a claim for the same offering returns the attached subscription to reuse, with no token');

-- Different offering while one is open ----------------------------------------
select is(billing_checkouts_test.claim('owner', 'owner_org', p_plan => 'growth'), 'conflict', 'a different plan is rejected');
select is(billing_checkouts_test.claim('owner', 'owner_org', p_interval => '3_month'), 'conflict', 'a different interval is rejected');
select is(billing_checkouts_test.claim('owner', 'owner_org', p_currency => 'USD'), 'conflict', 'a different currency is rejected');
select is((select row(internal_plan_id, billing_interval, currency, provider_subscription_id)::text
  from public.billing_checkouts where id = billing_checkouts_test.open_id('owner_org')),
  '(starter,1_month,INR,sub_owner_1)', 'a rejected claim does not change the open checkout');

-- Authorization ---------------------------------------------------------------
select throws_like($q$ select billing_checkouts_test.claim('nosy', 'owner_org') $q$,
  '%not authorized for this organization%', 'a user cannot claim a checkout for an organization they are not a member of');
select is((select count from dblink('nosy', format('select count(*) from public.billing_checkouts where organization_id = %L',
  billing_checkouts_test.id('owner_org'))) t(count bigint)), 0::bigint, 'a non-member cannot read the checkout');
select is((select count from dblink('owner', format('select count(*) from public.billing_checkouts where organization_id = %L',
  billing_checkouts_test.id('owner_org'))) t(count bigint)), 1::bigint, 'a member can read their own checkout');
select throws_like(
  format($q$ select dblink_exec('owner', 'update public.billing_checkouts set status = ''abandoned'' where organization_id = ''%s''') $q$,
    billing_checkouts_test.id('owner_org')),
  '%permission denied%', 'a user cannot update a checkout directly');
select throws_like(
  format($q$ select dblink_exec('teammate', 'update public.billing_checkouts set claim_token_hash = null, provider_subscription_id = ''sub_x'' where organization_id = ''%s''') $q$,
    billing_checkouts_test.id('owner_org')),
  '%permission denied%', 'a member cannot rewrite the token hash or provider id directly');
select throws_like(
  format($q$ select dblink_exec('owner', 'delete from public.billing_checkouts where organization_id = ''%s''') $q$,
    billing_checkouts_test.id('owner_org')),
  '%permission denied%', 'a user cannot delete a checkout directly');

-- Expiry ------------------------------------------------------------------------
do $$ begin perform billing_checkouts_test.expire(billing_checkouts_test.open_id('owner_org')); end $$;
do $$ begin perform billing_checkouts_test.claim_into('owner2', 'owner', 'owner_org', 'growth'); end $$;
select pass('an expired open checkout no longer blocks a new one (even for a different offering)');
select is((select status from public.billing_checkouts where provider_subscription_id = 'sub_owner_1'), 'abandoned',
  'the expired checkout is marked abandoned, its provider id kept');
select is(billing_checkouts_test.open_count('owner_org'), 1::bigint, 'still exactly one open checkout after expiry');

-- Release (provider call failed) ----------------------------------------------
select is(billing_checkouts_test.release('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner1')), false,
  'an earlier claim token does not release a later checkout');
select is(billing_checkouts_test.release('teammate', billing_checkouts_test.open_id('owner_org'), null), false,
  'another member still cannot release the new checkout');
select is(billing_checkouts_test.release('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner2')), true,
  'the claim token releases a checkout with no provider subscription');
select is(billing_checkouts_test.open_count('owner_org'), 0::bigint, 'the released checkout is no longer open');
select is((select claim_token_hash from public.billing_checkouts where organization_id = billing_checkouts_test.id('owner_org')
  and internal_plan_id = 'growth'), null::bytea, 'releasing clears the stored token hash');
select is(billing_checkouts_test.release('owner', (select id from public.billing_checkouts where organization_id = billing_checkouts_test.id('owner_org')
  and internal_plan_id = 'growth'), billing_checkouts_test.tok('owner2')), false, 'a token cannot be reused after release');
select is(billing_checkouts_test.attach('owner', (select id from public.billing_checkouts where organization_id = billing_checkouts_test.id('owner_org')
  and internal_plan_id = 'growth'), billing_checkouts_test.tok('owner2'), 'sub_late'), false, 'a released checkout cannot be attached to');

-- Attach after the claim expired ------------------------------------------------
do $$ begin perform billing_checkouts_test.claim_into('owner3', 'owner', 'owner_org'); end $$;
select pass('an abandoned checkout does not block a new one');
do $$ begin perform billing_checkouts_test.expire(billing_checkouts_test.open_id('owner_org')); end $$;
select is(billing_checkouts_test.attach('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner3'), 'sub_too_late'), false,
  'the claim token cannot attach to an expired checkout');
do $$ begin perform billing_checkouts_test.claim_into('owner4', 'owner', 'owner_org'); end $$;
select is((select row(status, claim_token_hash is null)::text from public.billing_checkouts
  where organization_id = billing_checkouts_test.id('owner_org') and status = 'abandoned' and provider_subscription_id is null
    and internal_plan_id = 'starter'), '(abandoned,t)', 'lazy expiry clears the abandoned claim token hash');
select is(billing_checkouts_test.release('owner', (select id from public.billing_checkouts where organization_id = billing_checkouts_test.id('owner_org')
  and status = 'abandoned' and provider_subscription_id is null and internal_plan_id = 'starter'), billing_checkouts_test.tok('owner3')), false,
  'a token cannot be reused after its checkout expired');

-- Completion (webhook, service role) -------------------------------------------
select is(billing_checkouts_test.attach('owner', billing_checkouts_test.open_id('owner_org'), billing_checkouts_test.tok('owner4'), 'sub_owner_2'), true,
  'the newest claim token attaches its subscription');
select lives_ok($q$ select dblink_exec('worker', 'update public.billing_checkouts set status = ''completed'' where provider = ''razorpay'' and provider_subscription_id = ''sub_owner_2'' and status = ''open''') $q$,
  'the service role (webhook) can complete a checkout');
select is((select row(status, claim_token_hash is null)::text from public.billing_checkouts where provider_subscription_id = 'sub_owner_2'),
  '(completed,t)', 'the completed checkout holds no token hash');
select is(billing_checkouts_test.attach('owner', (select id from public.billing_checkouts where provider_subscription_id = 'sub_owner_2'),
  billing_checkouts_test.tok('owner4'), 'sub_after_completion'), false, 'a token cannot be reused after completion');
select is(billing_checkouts_test.claim('owner', 'owner_org'), 'claimed#token', 'a completed checkout does not block a new one');
select is((select count(*) from public.billing_checkouts where claim_token_hash is not null
  and organization_id = billing_checkouts_test.id('owner_org')), 1::bigint,
  'only the one live, unattached claim holds a token hash');

-- Table-level invariants ----------------------------------------------------
select throws_ok(
  format($q$ select dblink_exec('admin', 'insert into public.billing_checkouts (organization_id, provider, internal_plan_id, billing_interval, currency, expires_at) values (''%s'', ''razorpay'', ''pro'', ''1_month'', ''USD'', now() + interval ''1 day'')') $q$,
    billing_checkouts_test.id('owner_org')),
  '23505', null, 'the partial unique index refuses a second open checkout for an organization, even for a privileged writer');
select lives_ok(
  format($q$ select dblink_exec('admin', 'insert into public.billing_checkouts (organization_id, provider, internal_plan_id, billing_interval, currency, status, expires_at) values (''%s'', ''razorpay'', ''pro'', ''1_month'', ''USD'', ''completed'', now()), (''%s'', ''razorpay'', ''pro'', ''1_month'', ''USD'', ''abandoned'', now())') $q$,
    billing_checkouts_test.id('owner_org'), billing_checkouts_test.id('owner_org')),
  'completed and abandoned checkouts are not limited by the invariant');
select throws_ok(
  format($q$ select dblink_exec('admin', 'insert into public.billing_checkouts (organization_id, provider, provider_subscription_id, internal_plan_id, billing_interval, currency, status, expires_at) values (''%s'', ''razorpay'', ''sub_owner_2'', ''pro'', ''1_month'', ''USD'', ''abandoned'', now())') $q$,
    billing_checkouts_test.id('fresh_org')),
  '23505', null, 'a provider subscription id can belong to only one checkout');
select throws_ok(
  format($q$ select dblink_exec('admin', 'insert into public.billing_checkouts (organization_id, provider, internal_plan_id, billing_interval, currency, status, expires_at) values (''%s'', ''razorpay'', ''starter'', ''1_month'', ''INR'', ''pending'', now())') $q$,
    billing_checkouts_test.id('fresh_org')),
  '23514', null, 'status is limited to open/completed/abandoned');
select throws_ok(
  format($q$ select dblink_exec('admin', 'insert into public.billing_checkouts (organization_id, provider, internal_plan_id, billing_interval, currency, status, expires_at, claim_token_hash) values (''%s'', ''razorpay'', ''starter'', ''1_month'', ''INR'', ''completed'', now(), ''\x00'')') $q$,
    billing_checkouts_test.id('fresh_org')),
  '23514', null, 'a token hash can only exist on an open, unattached checkout');
select throws_ok(
  format($q$ select dblink_exec('admin', 'update public.billing_checkouts set provider_subscription_id = ''sub_bypass'' where organization_id = ''%s'' and status = ''open''') $q$,
    billing_checkouts_test.id('owner_org')),
  '23514', null, 'even a privileged writer cannot attach an id while leaving the token hash in place');

-- Concurrency: two sessions, same organization, really concurrent -------------
-- race_a claims inside an open transaction (holding the org lock and an
-- uncommitted open row); race_b claims at the same time and must wait, then
-- see race_a's checkout instead of creating a second one.
do $$ begin
  perform dblink_exec('race_a', 'begin');
  perform * from dblink('race_a', format('select claim_outcome from public.claim_billing_checkout(%L, ''starter'', ''1_month'', ''INR'')',
    billing_checkouts_test.id('race_org'))) t(o text);
  perform dblink_send_query('race_b', format('select claim_outcome || coalesce(''#'' || claim_token, '''') from public.claim_billing_checkout(%L, ''starter'', ''1_month'', ''INR'')',
    billing_checkouts_test.id('race_org')));
end $$;
select ok(billing_checkouts_test.wait_until_blocked('billing_checkouts_test_race_b'),
  'a concurrent claim for the same organization waits for the first one');
do $$ begin perform dblink_exec('race_a', 'commit'); end $$;
select is((select o from dblink_get_result('race_b') t(o text)), 'existing',
  'the waiting claim sees the first checkout instead of creating a second, and gets no token');
do $$ begin perform * from dblink_get_result('race_b') t(o text); end $$;
select is(billing_checkouts_test.open_count('race_org'), 1::bigint, 'the race produced exactly one open checkout');

-- Same race with different offerings: the second is rejected, not added.
do $$ begin
  perform dblink_exec('admin', format('update public.billing_checkouts set status = ''abandoned'', claim_token_hash = null where organization_id = %L',
    billing_checkouts_test.id('race_org')));
  perform dblink_exec('race_a', 'begin');
  perform * from dblink('race_a', format('select claim_outcome from public.claim_billing_checkout(%L, ''starter'', ''1_month'', ''INR'')',
    billing_checkouts_test.id('race_org'))) t(o text);
  perform dblink_send_query('race_b', format('select claim_outcome from public.claim_billing_checkout(%L, ''pro'', ''12_month'', ''USD'')',
    billing_checkouts_test.id('race_org')));
end $$;
select ok(billing_checkouts_test.wait_until_blocked('billing_checkouts_test_race_b'), 'a concurrent different-offering claim waits too');
do $$ begin perform dblink_exec('race_a', 'commit'); end $$;
select is((select o from dblink_get_result('race_b') t(o text)), 'conflict',
  'the waiting different-offering claim is rejected');
do $$ begin perform * from dblink_get_result('race_b') t(o text); end $$;
select is(billing_checkouts_test.open_count('race_org'), 1::bigint, 'still exactly one open checkout');

-- The original gap: a member releases the checkout while the claiming request
-- is between Razorpay create and attach. Without the token it cannot, so a
-- second claim still sees the in-progress checkout and gets no new one.
select is(billing_checkouts_test.release('race_b', billing_checkouts_test.open_id('race_org'), null), false,
  'a parallel request cannot release the in-progress checkout of another request');
select is(billing_checkouts_test.claim('race_b', 'race_org'), 'existing',
  'so a second checkout still cannot be claimed while the first is in progress');

-- Organization deletion ---------------------------------------------------------
select is(billing_checkouts_test.claim('doomed', 'doomed_org'), 'claimed#token', 'a checkout exists before the organization is deleted');
select lives_ok(format($q$ select dblink_exec('admin', 'delete from public.organizations where id = ''%s''') $q$,
  billing_checkouts_test.id('doomed_org')), 'the organization can be deleted while it has a checkout');
select is((select count(*) from public.billing_checkouts where organization_id = billing_checkouts_test.id('doomed_org')), 0::bigint,
  'deleting the organization deletes its checkouts');

-- ---------------------------------------------------------------------------
select * from finish();

do $$ begin
  perform dblink_disconnect(name) from unnest(array['owner', 'teammate', 'nosy', 'fresh', 'race_a', 'race_b', 'doomed',
    'anon', 'worker', 'admin']) name;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Cleanup (committed fixtures). Deleting the users cascades their
-- organizations, and the organizations their checkouts.
-- ---------------------------------------------------------------------------
delete from auth.users where email like '%@billing-checkouts-test.invalid';
drop schema billing_checkouts_test cascade;
