-- Regression tests for request_send_now() and the send_now_step_id write
-- guard (supabase/migrations/20260926100000_campaign_leads_send_now_step.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- Same structure as claim_due_sends.test.sql: fixtures are committed up front
-- (dblink sessions only see committed rows), every action runs in a separate
-- dblink session under the real API role — "owner"/"other"/"pauser" as
-- authenticated users, "worker" as service_role — and fixtures are deleted
-- at the end. Where a test depends on one session actually being blocked on
-- another's lock, it waits for that state via pg_stat_activity (bounded,
-- fails after 5s) rather than sleeping for a fixed time.
--
-- Not covered here: the worker's own window decision and bypass consumption
-- (TypeScript — lib/email/scheduling.test.ts, lib/email/send-worker.test.ts).
-- The D1(b) section runs the SQL equivalent of deferDueCampaignLeads'
-- PostgREST call; that call's filter chain is pinned in send-worker.test.ts.

set client_min_messages = warning;

-- Children first — see claim_due_sends.test.sql's cleanup note.
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@send-now-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@send-now-test.invalid');
delete from auth.users where email like '%@send-now-test.invalid';
drop schema if exists send_now_test cascade;
create schema send_now_test;

create table send_now_test.fx (name text primary key, id uuid not null);

create function send_now_test.id(p_name text) returns uuid
language sql stable as $$ select id from send_now_test.fx where name = p_name $$;

create function send_now_test.lead(p_name text) returns public.campaign_leads
language sql stable as $$ select * from public.campaign_leads where id = send_now_test.id(p_name) $$;

-- One owner's campaign with a two-step sequence, one mailbox and a lead on
-- step 1. p_due is relative to now().
create function send_now_test.add_campaign(p_name text, p_user text, p_status text) returns void
language plpgsql as $$
declare v_campaign uuid; v_mailbox uuid; v_sequence uuid; v_step1 uuid; v_step2 uuid;
begin
  insert into public.mailboxes (user_id, email, smtp_host, smtp_username, encrypted_smtp_password, hourly_limit, daily_limit)
  values (send_now_test.id(p_user), p_name || '-mb@send-now-test.invalid', 'smtp.send-now-test.invalid', p_name, 'x', 100, 100)
  returning id into v_mailbox;
  insert into public.campaigns (user_id, name, status, daily_limit)
  values (send_now_test.id(p_user), p_name, p_status, 100) returning id into v_campaign;
  insert into public.sequences (campaign_id, name) values (v_campaign, p_name) returning id into v_sequence;
  insert into public.sequence_steps (sequence_id, step_order) values (v_sequence, 0) returning id into v_step1;
  insert into public.sequence_steps (sequence_id, step_order) values (v_sequence, 1) returning id into v_step2;
  insert into send_now_test.fx values (p_name, v_campaign), (p_name || '_mb', v_mailbox),
    (p_name || '_step1', v_step1), (p_name || '_step2', v_step2);
end $$;

create function send_now_test.add_lead(p_name text, p_campaign text, p_due interval,
  p_status text default 'active', p_locked_until timestamptz default null) returns void
language plpgsql as $$
declare
  v_owner uuid := (select user_id from public.campaigns where id = send_now_test.id(p_campaign));
  v_lead uuid; v_id uuid;
begin
  insert into public.leads (user_id, email) values (v_owner, p_name || '@send-now-test.invalid') returning id into v_lead;
  insert into public.campaign_leads (campaign_id, lead_id, mailbox_id, status, current_step_id, next_send_at, locked_until)
  values (send_now_test.id(p_campaign), v_lead, send_now_test.id(p_campaign || '_mb'), p_status,
    send_now_test.id(p_campaign || '_step1'), now() + p_due, p_locked_until)
  returning id into v_id;
  insert into send_now_test.fx values (p_name, v_id);
end $$;

-- Waits (max 5s) until the dblink session with this application_name is
-- blocked waiting on a lock. Fails loudly instead of guessing with a sleep.
create function send_now_test.wait_until_blocked(p_app text) returns boolean
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

create function send_now_test.conn_str(p_app text) returns text
language plpgsql stable as $$
begin
  if inet_server_addr() is null then
    raise exception 'send_now tests must connect over TCP (run via `supabase test db`)';
  end if;
  return format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
    host(inet_server_addr()), inet_server_port(), current_database(), p_app);
end $$;

-- The exact UPDATE lib/db/campaign-leads.ts's deferDueCampaignLeads sends
-- through PostgREST (same filters), with the worker's "now" passed in as a
-- literal the way the JS Date is.
create function send_now_test.bulk_defer_sql(p_campaign text) returns text
language sql stable as $$
  select format(
    'update public.campaign_leads set next_send_at = %L where campaign_id = %L and status = %L '
    'and next_send_at <= %L and send_now_step_id is null and (locked_until is null or locked_until < %L)',
    '2099-01-04 05:00:00+00', send_now_test.id(p_campaign), 'active', clock_timestamp(), clock_timestamp())
$$;

-- The conditional UPDATE lib/db/campaign-leads.ts's consumeSendNow sends
-- through PostgREST, as a row count: the worker only uses the bypass when
-- this matched a row.
create function send_now_test.consume_sql(p_lead text, p_step text) returns text
language sql stable as $$
  select format(
    'with u as (update public.campaign_leads set send_now_step_id = null where id = %L '
    'and send_now_step_id = %L and current_step_id = %L returning id) select count(*)::int from u',
    send_now_test.id(p_lead), send_now_test.id(p_step), send_now_test.id(p_step))
$$;

grant usage on schema send_now_test to authenticated, service_role;
grant select on send_now_test.fx to authenticated, service_role;
grant execute on all functions in schema send_now_test to authenticated, service_role;

do $fixtures$
declare v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_a, 'org_a@send-now-test.invalid'), (v_b, 'org_b@send-now-test.invalid');
  insert into send_now_test.fx values ('org_a', v_a), ('org_b', v_b);

  -- Basic RPC behavior. Leads are not due (next week) so no claim ever
  -- picks them up unless a test makes them due.
  perform send_now_test.add_campaign('c_basic', 'org_a', 'active');
  perform send_now_test.add_lead('l_ok', 'c_basic', interval '7 days');
  perform send_now_test.add_lead('l_leased', 'c_basic', interval '7 days', 'active', now() + interval '5 minutes');
  perform send_now_test.add_lead('l_review', 'c_basic', interval '7 days', 'needs_review');
  perform send_now_test.add_lead('l_guard', 'c_basic', interval '7 days');

  perform send_now_test.add_campaign('c_paused', 'org_a', 'paused');
  perform send_now_test.add_lead('l_paused', 'c_paused', interval '7 days');

  -- Race: worker claims first. Starts paused so no other test's claim can
  -- take its lead; activated only for its own test.
  perform send_now_test.add_campaign('c_race1', 'org_a', 'paused');
  perform send_now_test.add_lead('l_race1', 'c_race1', interval '-1 hour');

  -- Race: Send Now commits first.
  perform send_now_test.add_campaign('c_race2', 'org_a', 'paused');
  perform send_now_test.add_lead('l_race2', 'c_race2', interval '7 days');

  -- Race: pause vs an in-flight Send Now.
  perform send_now_test.add_campaign('c_pause', 'org_a', 'active');
  perform send_now_test.add_lead('l_pause', 'c_pause', interval '7 days');

  -- Pausing through a plain status edit (updateCampaignAction's raw status
  -- editor / the table API), not pauseCampaignAction, then resuming. A
  -- second campaign with its own pending request must be left alone.
  perform send_now_test.add_campaign('c_edit', 'org_a', 'active');
  perform send_now_test.add_lead('l_edit', 'c_edit', interval '7 days');
  perform send_now_test.add_campaign('c_bystander', 'org_a', 'active');
  perform send_now_test.add_lead('l_bystander', 'c_bystander', interval '7 days');

  -- D1(b) bulk deferral. Campaigns start paused so no claim in an earlier
  -- test can take their due leads; the bulk UPDATE ignores campaign status.
  perform send_now_test.add_campaign('c_bulk', 'org_a', 'paused');
  perform send_now_test.add_lead('b_due', 'c_bulk', interval '-1 hour');
  perform send_now_test.add_lead('b_due_expired_lease', 'c_bulk', interval '-1 hour', 'active', now() - interval '1 minute');
  perform send_now_test.add_lead('b_future', 'c_bulk', interval '2 days');
  perform send_now_test.add_lead('b_leased', 'c_bulk', interval '-1 hour', 'active', now() + interval '5 minutes');
  perform send_now_test.add_lead('b_review', 'c_bulk', interval '-1 hour', 'needs_review');
  perform send_now_test.add_lead('b_send_now', 'c_bulk', interval '-1 hour');
  update public.campaign_leads set send_now_step_id = current_step_id where id = send_now_test.id('b_send_now');
  perform send_now_test.add_campaign('c_bulk_other', 'org_a', 'paused');
  perform send_now_test.add_lead('b_other', 'c_bulk_other', interval '-1 hour');
  -- Races: a claim in flight, and a Send Now in flight.
  perform send_now_test.add_campaign('c_bulk_claim', 'org_a', 'paused');
  perform send_now_test.add_lead('b_race_claim', 'c_bulk_claim', interval '-1 hour');
  perform send_now_test.add_campaign('c_bulk_sn', 'org_a', 'paused');
  perform send_now_test.add_lead('b_race_sn', 'c_bulk_sn', interval '-1 hour');

  -- B1: the worker's conditional consume vs a pause after its claim.
  perform send_now_test.add_campaign('c_consume', 'org_a', 'paused');
  perform send_now_test.add_lead('l_consume', 'c_consume', interval '7 days');
  perform send_now_test.add_campaign('c_consume_ok', 'org_a', 'paused');
  perform send_now_test.add_lead('l_consume_ok', 'c_consume_ok', interval '7 days');
end
$fixtures$;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

select plan(48);

do $$
declare
  v_session record;
begin
  for v_session in
    select * from (values ('owner', 'authenticated', 'org_a'), ('other', 'authenticated', 'org_b'),
      ('pauser', 'authenticated', 'org_a'), ('worker', 'service_role', null), ('ctl', null, null)) s(name, role, org)
  loop
    perform dblink_connect(v_session.name, send_now_test.conn_str('send_now_test_' || v_session.name));
    if v_session.role is not null then
      perform dblink_exec(v_session.name, format('set role %I', v_session.role));
      perform dblink_exec(v_session.name, 'set statement_timeout = ''10s''');
    end if;
    if v_session.org is not null then
      perform dblink_exec(v_session.name, format('set request.jwt.claims = %L',
        json_build_object('sub', send_now_test.id(v_session.org), 'role', 'authenticated')::text));
    end if;
  end loop;
end $$;

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.request_send_now(uuid)', 'execute'),
  'anon cannot execute request_send_now');
select ok(has_function_privilege('authenticated', 'public.request_send_now(uuid)', 'execute'),
  'authenticated can execute request_send_now');

-- request_send_now ------------------------------------------------------------
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_ok'))) t(ok boolean)),
  true, 'owner: Send Now on an eligible lead succeeds');
select is((send_now_test.lead('l_ok')).send_now_step_id, send_now_test.id('c_basic_step1'),
  'the bypass is recorded for the lead''s current step');
select ok((send_now_test.lead('l_ok')).next_send_at <= now() + interval '1 minute',
  'next_send_at is pulled forward to now');
select is((send_now_test.lead('l_ok')).current_step_id, send_now_test.id('c_basic_step1'),
  'current_step_id is untouched');
select is((send_now_test.lead('l_ok')).mailbox_id, send_now_test.id('c_basic_mb'),
  'mailbox_id is untouched');

select is((select ok from dblink('other', format('select public.request_send_now(%L)', send_now_test.id('l_guard'))) t(ok boolean)),
  false, 'another organization cannot Send Now a lead it does not own');
select is((send_now_test.lead('l_guard')).send_now_step_id, null,
  '...and the lead is unchanged');
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_leased'))) t(ok boolean)),
  false, 'a lead leased by the worker is refused');
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_review'))) t(ok boolean)),
  false, 'a non-active lead is refused');
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_paused'))) t(ok boolean)),
  false, 'a lead in a paused campaign is refused');

-- Write guard -----------------------------------------------------------------
select throws_like(
  format('select dblink_exec(%L, %L)', 'owner',
    format('update public.campaign_leads set send_now_step_id = %L where id = %L',
      send_now_test.id('c_basic_step1'), send_now_test.id('l_guard'))),
  '%can only be set through request_send_now%',
  'an owner cannot set send_now_step_id directly through the table API');
select is((send_now_test.lead('l_guard')).send_now_step_id, null, '...so the bypass stays unset');
select lives_ok(
  format('select dblink_exec(%L, %L)', 'owner',
    format('update public.campaign_leads set send_now_step_id = null where id = %L', send_now_test.id('l_ok'))),
  'an owner can still clear send_now_step_id (what pausing does)');
select is((send_now_test.lead('l_ok')).send_now_step_id, null, '...and it is cleared');

-- Race: the worker claims first ----------------------------------------------
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''active'' where id = %L', send_now_test.id('c_race1')));
  perform dblink_exec('worker', 'begin');
end $$;
select is((select array_agg(id) from dblink('worker', 'select id from public.claim_due_sends(25)') t(id uuid)),
  array[send_now_test.id('l_race1')], 'race 1: the worker claims the lead (uncommitted)');
do $$ begin
  perform dblink_send_query('owner', format('select public.request_send_now(%L)', send_now_test.id('l_race1')));
end $$;
select ok(send_now_test.wait_until_blocked('send_now_test_owner'),
  'race 1: Send Now blocks on the worker''s row lock instead of writing');
do $$ begin perform dblink_exec('worker', 'commit'); end $$;
select is((select ok from dblink_get_result('owner') t(ok boolean)), false,
  'race 1: once the claim commits, Send Now re-checks the leased row and is refused');
do $$ begin perform * from dblink_get_result('owner') t(ok boolean); end $$;
select is((send_now_test.lead('l_race1')).send_now_step_id, null,
  'race 1: no bypass was recorded on a lead the worker already owns');

-- Race: Send Now commits first -------------------------------------------------
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_race1')));
  perform dblink_exec('ctl', format('update public.campaigns set status = ''active'' where id = %L', send_now_test.id('c_race2')));
  perform dblink_exec('owner', 'begin');
end $$;
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_race2'))) t(ok boolean)),
  true, 'race 2: Send Now succeeds (uncommitted)');
select is((select count(*)::int from dblink('worker', 'select id from public.claim_due_sends(25)') t(id uuid)), 0,
  'race 2: a concurrent claim skips the lead instead of acting on it mid-request');
do $$ begin perform dblink_exec('owner', 'commit'); end $$;
select is((select send_now_step_id from dblink('worker', 'select send_now_step_id from public.claim_due_sends(25)') t(send_now_step_id uuid)),
  send_now_test.id('c_race2_step1'),
  'race 2: after Send Now commits, the claim returns the lead with its bypass for the worker to honor');

-- Race: pause vs an in-flight Send Now --------------------------------------
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_race2')));
  perform dblink_exec('owner', 'begin');
  perform * from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_pause'))) t(ok boolean);
  -- pauseCampaignAction: a single status update; the trigger does the clear.
  perform dblink_send_query('pauser', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_pause')));
end $$;
select ok(send_now_test.wait_until_blocked('send_now_test_pauser'),
  'pause race: pausing waits for the in-flight Send Now (campaign row held FOR SHARE)');
do $$ begin
  perform dblink_exec('owner', 'commit');
  perform * from dblink_get_result('pauser') t(status text);
  perform * from dblink_get_result('pauser') t(status text);
end $$;
select is((send_now_test.lead('l_pause')).send_now_step_id, null,
  'pause race: the pause itself clears the Send Now that committed just before it');
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_pause'))) t(ok boolean)),
  false, 'pause race: after the pause, no new Send Now can be recorded');

-- Any path out of 'active' clears; resuming does not restore ------------------
do $$ begin
  perform * from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_edit'))) t(ok boolean);
  perform * from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_bystander'))) t(ok boolean);
end $$;
select is((send_now_test.lead('l_edit')).send_now_step_id, send_now_test.id('c_edit_step1'),
  'status edit: a Send Now is pending before the edit');
select lives_ok(
  format('select dblink_exec(%L, %L)', 'owner',
    format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_edit'))),
  'status edit: the owner pauses with a plain campaigns update');
select is((send_now_test.lead('l_edit')).send_now_step_id, null,
  'status edit: the pending Send Now is cleared by the trigger');
select is((send_now_test.lead('l_bystander')).send_now_step_id, send_now_test.id('c_bystander_step1'),
  'status edit: another campaign''s pending Send Now is untouched');
do $$ begin
  perform dblink_exec('owner', format('update public.campaigns set status = ''active'' where id = %L', send_now_test.id('c_edit')));
end $$;
select is((send_now_test.lead('l_edit')).send_now_step_id, null,
  'resume: the old Send Now does not come back');

-- D1(b) bulk deferral: what it touches --------------------------------------
do $$ begin
  -- Keep the claim below isolated to its own race campaign.
  perform dblink_exec('ctl', format('update public.campaigns set status = ''paused'' where id in (%L, %L)',
    send_now_test.id('c_edit'), send_now_test.id('c_bystander')));
  perform dblink_exec('worker', send_now_test.bulk_defer_sql('c_bulk'));
end $$;
select is((send_now_test.lead('b_due')).next_send_at, '2099-01-04 05:00:00+00'::timestamptz,
  'bulk: a due, active, unleased lead moves to the next opening');
select is((send_now_test.lead('b_due_expired_lease')).next_send_at, '2099-01-04 05:00:00+00'::timestamptz,
  'bulk: an expired lease counts as unleased');
select ok((send_now_test.lead('b_future')).next_send_at < now() + interval '3 days',
  'bulk: a lead not yet due is untouched');
select ok((send_now_test.lead('b_leased')).next_send_at < now(),
  'bulk: a leased lead is untouched');
select ok((send_now_test.lead('b_review')).next_send_at < now(),
  'bulk: a non-active lead is untouched');
select ok((send_now_test.lead('b_send_now')).next_send_at < now()
    and (send_now_test.lead('b_send_now')).send_now_step_id = send_now_test.id('c_bulk_step1'),
  'bulk: a lead with a pending Send Now is untouched');
select ok((send_now_test.lead('b_other')).next_send_at < now(),
  'bulk: another campaign''s due lead is untouched');

-- D1(b) race: a claim holds the row -----------------------------------------
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''active'' where id = %L', send_now_test.id('c_bulk_claim')));
  perform dblink_exec('ctl', 'begin');
end $$;
select is((select array_agg(id) from dblink('ctl', 'select id from public.claim_due_sends(25)') t(id uuid)),
  array[send_now_test.id('b_race_claim')], 'bulk race 1: a claim leases the lead (uncommitted)');
do $$ begin perform dblink_send_query('worker', send_now_test.bulk_defer_sql('c_bulk_claim')); end $$;
select ok(send_now_test.wait_until_blocked('send_now_test_worker'),
  'bulk race 1: the bulk deferral waits on the claim''s row lock');
do $$ begin
  perform dblink_exec('ctl', 'commit');
  perform * from dblink_get_result('worker') t(status text);
  perform * from dblink_get_result('worker') t(status text);
end $$;
select ok((send_now_test.lead('b_race_claim')).next_send_at < now()
    and (send_now_test.lead('b_race_claim')).locked_until > now(),
  'bulk race 1: after the claim commits, the now-leased lead is re-checked and left alone');

-- D1(b) race: a Send Now holds the row --------------------------------------
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_bulk_claim')));
  perform dblink_exec('ctl', format('update public.campaigns set status = ''active'' where id = %L', send_now_test.id('c_bulk_sn')));
  perform dblink_exec('owner', 'begin');
end $$;
select is((select ok from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('b_race_sn'))) t(ok boolean)),
  true, 'bulk race 2: Send Now succeeds (uncommitted)');
do $$ begin perform dblink_send_query('worker', send_now_test.bulk_defer_sql('c_bulk_sn')); end $$;
select ok(send_now_test.wait_until_blocked('send_now_test_worker'),
  'bulk race 2: the bulk deferral waits on the Send Now''s row lock');
do $$ begin
  perform dblink_exec('owner', 'commit');
  perform * from dblink_get_result('worker') t(status text);
  perform * from dblink_get_result('worker') t(status text);
end $$;
-- request_send_now set next_send_at to its own transaction's now(), which
-- is later than this test transaction's frozen now() — so compare against
-- the deferral target, not now().
select is((send_now_test.lead('b_race_sn')).send_now_step_id, send_now_test.id('c_bulk_sn_step1'),
  'bulk race 2: the committed Send Now''s bypass is not overwritten');
select ok((send_now_test.lead('b_race_sn')).next_send_at < clock_timestamp(),
  'bulk race 2: ...and the lead is not deferred (still due now, not at the next opening)');
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_bulk_sn')));
end $$;

-- B1: conditional consume after a pause ------------------------------------
-- The worker's claimed copy shows the bypass; the pause trigger has since
-- cleared it in the database. The consume must match nothing, so the worker
-- treats the bypass as gone and does not send.
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''active'' where id in (%L, %L)',
    send_now_test.id('c_consume'), send_now_test.id('c_consume_ok')));
  perform * from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_consume'))) t(ok boolean);
  perform * from dblink('owner', format('select public.request_send_now(%L)', send_now_test.id('l_consume_ok'))) t(ok boolean);
  perform dblink_exec('pauser', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_consume')));
end $$;
select is((select n from dblink('worker', send_now_test.consume_sql('l_consume', 'c_consume_step1')) t(n int)), 0,
  'B1: after a pause, the conditional consume of the stale claimed bypass matches 0 rows');
select is((select n from dblink('worker', send_now_test.consume_sql('l_consume_ok', 'c_consume_ok_step1')) t(n int)), 1,
  'B1: with the bypass still present, the conditional consume matches exactly the lead');
select is((send_now_test.lead('l_consume_ok')).send_now_step_id, null,
  'B1: ...and consuming clears it, so it cannot be used twice');
do $$ begin
  perform dblink_exec('ctl', format('update public.campaigns set status = ''paused'' where id = %L', send_now_test.id('c_consume_ok')));
end $$;

-- ---------------------------------------------------------------------------
select * from finish();

do $$ begin
  perform dblink_disconnect(name) from unnest(array['owner', 'other', 'pauser', 'worker', 'ctl']) name;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Cleanup (committed fixtures)
-- ---------------------------------------------------------------------------
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@send-now-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@send-now-test.invalid');
delete from auth.users where email like '%@send-now-test.invalid';
drop schema send_now_test cascade;
