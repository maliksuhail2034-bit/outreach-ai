-- Regression tests for the claim-to-send status race
-- (supabase/migrations/20260927100000_send_status_race_guard.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- Same structure as send_now.test.sql: fixtures are committed up front
-- (dblink sessions only see committed rows) and every action runs in its own
-- dblink session under the real role — "worker" and "replier" as
-- service_role (the send and reply workers both use the admin client),
-- "ctl" as postgres for the user-side writes (pause, stop, removal). Every
-- lead is leased and not due for a week, so no real claim can take it.
--
-- The worker's claimed-copy flow is reproduced exactly: claim_send_attempt,
-- then confirm_send_attempt_eligible (immediately before the provider call),
-- then record_send_success / record_send_failure — with the competing write
-- landing between those steps. One case holds the reply write open in a
-- transaction to prove the check waits for it rather than reading a stale
-- row. The TypeScript side (the worker returning before provider.send) is
-- covered by lib/email/send-worker-status-race.test.ts.

set client_min_messages = warning;

delete from public.email_events where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@status-race-test.invalid');
delete from public.suppressions where user_id in (select id from auth.users where email like '%@status-race-test.invalid');
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@status-race-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@status-race-test.invalid');
delete from auth.users where email like '%@status-race-test.invalid';
drop schema if exists status_race_test cascade;
create schema status_race_test;

create table status_race_test.fx (name text primary key, id uuid not null);

create function status_race_test.id(p_name text) returns uuid
language sql stable as $$ select id from status_race_test.fx where name = p_name $$;

create function status_race_test.lead(p_name text) returns public.campaign_leads
language sql stable as $$ select * from public.campaign_leads where id = status_race_test.id(p_name) $$;

create function status_race_test.attempts(p_name text) returns bigint
language sql stable as $$ select count(*) from public.send_attempts where campaign_lead_id = status_race_test.id(p_name) $$;

create function status_race_test.attempt_status(p_name text) returns text
language sql stable as $$ select status from public.send_attempts where campaign_lead_id = status_race_test.id(p_name) $$;

-- A campaign with a two-step sequence and one mailbox.
create function status_race_test.add_campaign(p_name text, p_user text, p_status text) returns void
language plpgsql as $$
declare v_campaign uuid; v_mailbox uuid; v_sequence uuid; v_step1 uuid; v_step2 uuid;
begin
  insert into public.mailboxes (user_id, email, smtp_host, smtp_username, encrypted_smtp_password, hourly_limit, daily_limit)
  values (status_race_test.id(p_user), p_name || '-mb@status-race-test.invalid', 'smtp.status-race-test.invalid', p_name, 'x', 100, 100)
  returning id into v_mailbox;
  insert into public.campaigns (user_id, name, status, daily_limit)
  values (status_race_test.id(p_user), p_name, p_status, 100) returning id into v_campaign;
  insert into public.sequences (campaign_id, name) values (v_campaign, p_name) returning id into v_sequence;
  insert into public.sequence_steps (sequence_id, step_order) values (v_sequence, 0) returning id into v_step1;
  insert into public.sequence_steps (sequence_id, step_order) values (v_sequence, 1) returning id into v_step2;
  insert into status_race_test.fx values (p_name, v_campaign), (p_name || '_mb', v_mailbox),
    (p_name || '_step1', v_step1), (p_name || '_step2', v_step2);
end $$;

-- An active lead on step 1, already leased by the worker (as after
-- claim_due_sends), not due for a week.
create function status_race_test.add_lead(p_name text, p_campaign text) returns void
language plpgsql as $$
declare
  v_owner uuid := (select user_id from public.campaigns where id = status_race_test.id(p_campaign));
  v_lead uuid; v_id uuid;
begin
  insert into public.leads (user_id, email) values (v_owner, p_name || '@status-race-test.invalid') returning id into v_lead;
  insert into public.campaign_leads (campaign_id, lead_id, mailbox_id, status, current_step_id, next_send_at, locked_until)
  values (status_race_test.id(p_campaign), v_lead, status_race_test.id(p_campaign || '_mb'), 'active',
    status_race_test.id(p_campaign || '_step1'), now() + interval '7 days', now() + interval '10 minutes')
  returning id into v_id;
  insert into status_race_test.fx values (p_name, v_id), (p_name || '_campaign', status_race_test.id(p_campaign)),
    (p_name || '_step1', status_race_test.id(p_campaign || '_step1')),
    (p_name || '_step2', status_race_test.id(p_campaign || '_step2'));
end $$;

-- The worker's calls, as SQL text for its dblink session.
create function status_race_test.claim_sql(p_lead text) returns text
language sql stable as $$
  select format('select id from public.claim_send_attempt(%L, %L)', status_race_test.id(p_lead), status_race_test.id(p_lead || '_step1'))
$$;

create function status_race_test.confirm_sql(p_lead text, p_attempt uuid) returns text
language sql stable as $$
  select format('select public.confirm_send_attempt_eligible(%L, %L, %L)',
    p_attempt, status_race_test.id(p_lead), status_race_test.id(p_lead || '_step1'))
$$;

create function status_race_test.success_sql(p_lead text, p_attempt uuid) returns text
language sql stable as $$
  select format('select public.record_send_success(%L, %L, %L, %L, %L, %L, %L, %L, %L)',
    p_attempt, cl.id, cl.campaign_id, cl.lead_id, cl.mailbox_id, 'msg-' || cl.id, 'active',
    status_race_test.id(p_lead || '_step2'), '2099-01-01 00:00:00+00')
  from public.campaign_leads cl where cl.id = status_race_test.id(p_lead)
$$;

create function status_race_test.failure_sql(p_lead text, p_attempt uuid, p_outcome text) returns text
language sql stable as $$
  select format('select public.record_send_failure(%L, %L, %L, %L, %L, %L, %L, %L)',
    p_attempt, cl.id, cl.campaign_id, cl.lead_id, cl.mailbox_id, 'provider said no', p_outcome, '2099-01-02 00:00:00+00')
  from public.campaign_leads cl where cl.id = status_race_test.id(p_lead)
$$;

-- The reply worker's exact campaign_leads write (lib/email/reply-worker.ts).
create function status_race_test.reply_sql(p_lead text) returns text
language sql stable as $$
  select format('update public.campaign_leads set status = %L, current_step_id = null, next_send_at = null where id = %L',
    'replied', status_race_test.id(p_lead))
$$;

-- The exact conditional UPDATE lib/db/campaign-leads.ts's
-- updateClaimedCampaignLead sends through PostgREST for the worker's
-- needs_review and "already sent" self-heal writes, as a row count.
create function status_race_test.guarded_sql(p_lead text, p_set text) returns text
language sql stable as $$
  select format(
    'with u as (update public.campaign_leads set %s where id = %L and status = %L and current_step_id = %L returning id) '
    'select count(*)::int from u',
    p_set, status_race_test.id(p_lead), 'active', status_race_test.id(p_lead || '_step1'))
$$;

create function status_race_test.heal_set(p_lead text) returns text
language sql stable as $$
  select format('status = %L, current_step_id = %L, next_send_at = %L, locked_until = null',
    'active', status_race_test.id(p_lead || '_step2'), '2099-01-03 00:00:00+00')
$$;

create function status_race_test.wait_until_blocked(p_app text) returns boolean
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

create function status_race_test.conn_str(p_app text) returns text
language plpgsql stable as $$
begin
  if inet_server_addr() is null then
    raise exception 'status race tests must connect over TCP (run via `supabase test db`)';
  end if;
  return format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
    host(inet_server_addr()), inet_server_port(), current_database(), p_app);
end $$;

grant usage on schema status_race_test to service_role;
grant select on status_race_test.fx to service_role;
grant execute on all functions in schema status_race_test to service_role;

do $fixtures$
declare v_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_a, 'org_a@status-race-test.invalid');
  insert into status_race_test.fx values ('org_a', v_a);

  perform status_race_test.add_campaign('c_main', 'org_a', 'active');
  perform status_race_test.add_lead('l_ok', 'c_main');
  perform status_race_test.add_lead('l_reply_first', 'c_main');
  perform status_race_test.add_lead('l_reply_concurrent', 'c_main');
  perform status_race_test.add_lead('l_reply_mid_send', 'c_main');
  perform status_race_test.add_lead('l_reply_then_fail', 'c_main');
  perform status_race_test.add_lead('l_reply_then_bounce', 'c_main');
  perform status_race_test.add_lead('l_retry', 'c_main');
  perform status_race_test.add_lead('l_bounce', 'c_main');
  perform status_race_test.add_lead('l_cancelled', 'c_main');
  perform status_race_test.add_lead('l_unsubscribed', 'c_main');
  perform status_race_test.add_lead('l_removed', 'c_main');
  perform status_race_test.add_lead('l_step_changed', 'c_main');
  perform status_race_test.add_lead('l_send_now', 'c_main');
  update public.campaign_leads set send_now_step_id = current_step_id where id = status_race_test.id('l_send_now');

  perform status_race_test.add_lead('l_heal_ok', 'c_main');
  perform status_race_test.add_lead('l_heal_replied', 'c_main');
  perform status_race_test.add_lead('l_heal_concurrent', 'c_main');
  perform status_race_test.add_lead('l_review_cancelled', 'c_main');
  perform status_race_test.add_lead('l_review_removed', 'c_main');

  perform status_race_test.add_campaign('c_pause', 'org_a', 'active');
  perform status_race_test.add_lead('l_paused', 'c_pause');
end
$fixtures$;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

select plan(58);

do $$
declare v_session record;
begin
  for v_session in
    select * from (values ('worker', 'service_role'), ('replier', 'service_role'), ('ctl', null)) s(name, role)
  loop
    perform dblink_connect(v_session.name, status_race_test.conn_str('status_race_test_' || v_session.name));
    if v_session.role is not null then
      perform dblink_exec(v_session.name, format('set role %I', v_session.role));
      perform dblink_exec(v_session.name, 'set statement_timeout = ''10s''');
    end if;
  end loop;
end $$;

create temp table attempt (name text primary key, id uuid);

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.confirm_send_attempt_eligible(uuid, uuid, uuid)', 'execute'),
  'anon cannot execute confirm_send_attempt_eligible');
select ok(not has_function_privilege('authenticated', 'public.confirm_send_attempt_eligible(uuid, uuid, uuid)', 'execute'),
  'authenticated cannot execute confirm_send_attempt_eligible');
select ok(has_function_privilege('service_role', 'public.confirm_send_attempt_eligible(uuid, uuid, uuid)', 'execute'),
  'service_role (the worker) can execute confirm_send_attempt_eligible');

-- C: a normal active lead still sends and advances ---------------------------
insert into attempt select 'l_ok', id from dblink('worker', status_race_test.claim_sql('l_ok')) t(id uuid);
select is((select r from dblink('worker', status_race_test.confirm_sql('l_ok', (select id from attempt where name = 'l_ok'))) t(r text)),
  'ok', 'C: an active lead on its claimed step in an active campaign is eligible');
select is(status_race_test.attempt_status('l_ok'), 'pending', 'C: ...its claimed attempt is left pending for the send');
select ok((status_race_test.lead('l_ok')).locked_until > now(), 'C: ...and the worker keeps its lease');
do $$ begin perform * from dblink('worker', status_race_test.success_sql('l_ok', (select id from attempt where name = 'l_ok'))) t(v text); end $$;
select is((status_race_test.lead('l_ok')).status, 'active', 'C: after the send the lead stays active');
select is((status_race_test.lead('l_ok')).current_step_id, status_race_test.id('l_ok_step2'), 'C: ...and advances to the next step');
select is((status_race_test.lead('l_ok')).locked_until, null, 'C: ...with its lease released');
select is(status_race_test.attempt_status('l_ok'), 'sent', 'C: the attempt is recorded as sent');
select is((select count(*) from public.email_events where lead_id = (status_race_test.lead('l_ok')).lead_id and event_type = 'sent'),
  1::bigint, 'C: exactly one sent event is recorded');

-- A: claimed while active, replied before the send ---------------------------
insert into attempt select 'l_reply_first', id from dblink('worker', status_race_test.claim_sql('l_reply_first')) t(id uuid);
do $$ begin perform dblink_exec('replier', status_race_test.reply_sql('l_reply_first')); end $$;
select is((select r from dblink('worker', status_race_test.confirm_sql('l_reply_first', (select id from attempt where name = 'l_reply_first'))) t(r text)),
  'lead_replied', 'A: a lead that replied after its claim is refused before the provider call');
select is(status_race_test.attempts('l_reply_first'), 0::bigint, 'A: the unsent pending attempt is deleted');
select is((status_race_test.lead('l_reply_first')).status, 'replied', 'A: the reply status stands');
select is((status_race_test.lead('l_reply_first')).locked_until, null, 'A: the lease is released');

-- A (concurrent): the reply is still committing when the worker checks -------
insert into attempt select 'l_reply_concurrent', id from dblink('worker', status_race_test.claim_sql('l_reply_concurrent')) t(id uuid);
do $$ begin
  perform dblink_exec('replier', 'begin');
  perform dblink_exec('replier', status_race_test.reply_sql('l_reply_concurrent'));
  perform dblink_send_query('worker', status_race_test.confirm_sql('l_reply_concurrent', (select id from attempt where name = 'l_reply_concurrent')));
end $$;
select ok(status_race_test.wait_until_blocked('status_race_test_worker'),
  'A (concurrent): the check waits on the lead row the uncommitted reply holds');
do $$ begin perform dblink_exec('replier', 'commit'); end $$;
select is((select r from dblink_get_result('worker') t(r text)), 'lead_replied',
  'A (concurrent): once the reply commits, the check sees it and refuses');
do $$ begin perform * from dblink_get_result('worker') t(r text); end $$;
select is(status_race_test.attempts('l_reply_concurrent'), 0::bigint, 'A (concurrent): no attempt is left behind');

-- B: the reply lands during the provider call --------------------------------
insert into attempt select 'l_reply_mid_send', id from dblink('worker', status_race_test.claim_sql('l_reply_mid_send')) t(id uuid);
select is((select r from dblink('worker', status_race_test.confirm_sql('l_reply_mid_send', (select id from attempt where name = 'l_reply_mid_send'))) t(r text)),
  'ok', 'B: the lead is still active at the check');
do $$ begin
  perform dblink_exec('replier', status_race_test.reply_sql('l_reply_mid_send'));
  perform * from dblink('worker', status_race_test.success_sql('l_reply_mid_send', (select id from attempt where name = 'l_reply_mid_send'))) t(v text);
end $$;
select is((status_race_test.lead('l_reply_mid_send')).status, 'replied', 'B: record_send_success does not overwrite a newer reply');
select is((status_race_test.lead('l_reply_mid_send')).current_step_id, null, 'B: ...nor restart the sequence');
select is((status_race_test.lead('l_reply_mid_send')).next_send_at, null, 'B: ...nor schedule another send');
select is((status_race_test.lead('l_reply_mid_send')).locked_until, null, 'B: the lease is still released');
select is(status_race_test.attempt_status('l_reply_mid_send'), 'sent', 'B: the send that did happen is recorded');
select is((select count(*) from public.email_events where lead_id = (status_race_test.lead('l_reply_mid_send')).lead_id and event_type = 'sent'),
  1::bigint, 'B: ...with its sent event');

-- B: the same for a failed send (retry and bounce) ---------------------------
insert into attempt select 'l_reply_then_fail', id from dblink('worker', status_race_test.claim_sql('l_reply_then_fail')) t(id uuid);
do $$ begin
  perform dblink_exec('replier', status_race_test.reply_sql('l_reply_then_fail'));
  perform * from dblink('worker', status_race_test.failure_sql('l_reply_then_fail', (select id from attempt where name = 'l_reply_then_fail'), 'retry')) t(v text);
end $$;
select is((status_race_test.lead('l_reply_then_fail')).status, 'replied', 'B: a retryable failure does not reset a replied lead to active');
select is(status_race_test.attempt_status('l_reply_then_fail'), 'failed', 'B: ...while the attempt is still marked failed');

insert into attempt select 'l_reply_then_bounce', id from dblink('worker', status_race_test.claim_sql('l_reply_then_bounce')) t(id uuid);
do $$ begin
  perform dblink_exec('replier', status_race_test.reply_sql('l_reply_then_bounce'));
  perform * from dblink('worker', status_race_test.failure_sql('l_reply_then_bounce', (select id from attempt where name = 'l_reply_then_bounce'), 'bounced')) t(v text);
end $$;
select is((status_race_test.lead('l_reply_then_bounce')).status, 'replied', 'B: a bounce does not overwrite a replied lead');
select is((select count(*) from public.suppressions where email = 'l_reply_then_bounce@status-race-test.invalid' and reason = 'bounced'),
  1::bigint, 'F: ...but the bounced address is still suppressed');
select is((select count(*) from public.email_events where lead_id = (status_race_test.lead('l_reply_then_bounce')).lead_id and event_type = 'bounced'),
  1::bigint, 'F: ...and the bounce event is still recorded');

-- Unchanged failure behavior for a lead that is still active -----------------
insert into attempt select 'l_retry', id from dblink('worker', status_race_test.claim_sql('l_retry')) t(id uuid);
do $$ begin perform * from dblink('worker', status_race_test.failure_sql('l_retry', (select id from attempt where name = 'l_retry'), 'retry')) t(v text); end $$;
select is((status_race_test.lead('l_retry')).status, 'active', 'a retryable failure on an active lead keeps it active');
select is((status_race_test.lead('l_retry')).next_send_at, '2099-01-02 00:00:00+00'::timestamptz, '...rescheduled to the retry time');
select is((status_race_test.lead('l_retry')).locked_until, null, '...with the lease released');

insert into attempt select 'l_bounce', id from dblink('worker', status_race_test.claim_sql('l_bounce')) t(id uuid);
do $$ begin perform * from dblink('worker', status_race_test.failure_sql('l_bounce', (select id from attempt where name = 'l_bounce'), 'bounced')) t(v text); end $$;
select is((status_race_test.lead('l_bounce')).status, 'bounced', 'a bounce on an active lead still marks it bounced');

-- E: paused / cancelled / unsubscribed / removed / moved on ------------------
insert into attempt select 'l_paused', id from dblink('worker', status_race_test.claim_sql('l_paused')) t(id uuid);
do $$ begin perform dblink_exec('ctl', format('update public.campaigns set status = %L where id = %L', 'paused', status_race_test.id('c_pause'))); end $$;
select is((select r from dblink('worker', status_race_test.confirm_sql('l_paused', (select id from attempt where name = 'l_paused'))) t(r text)),
  'campaign_paused', 'E: a campaign paused after the claim is not sent to');
select is(status_race_test.attempts('l_paused'), 0::bigint, 'E: ...its unsent attempt is deleted');
select is((status_race_test.lead('l_paused')).status, 'active', 'E: ...the lead itself stays active for the resume');
select is((status_race_test.lead('l_paused')).locked_until, null, 'E: ...with its lease released');
do $$ begin perform dblink_exec('ctl', format('update public.campaigns set status = %L where id = %L', 'active', status_race_test.id('c_pause'))); end $$;
select isnt((select id from dblink('worker', status_race_test.claim_sql('l_paused')) t(id uuid)), null,
  'E: after resume the same step claims afresh (not mistaken for an unknown outcome)');

insert into attempt select 'l_cancelled', id from dblink('worker', status_race_test.claim_sql('l_cancelled')) t(id uuid);
do $$ begin perform dblink_exec('ctl', format('update public.campaign_leads set status = %L, next_send_at = null, locked_until = null where id = %L', 'cancelled', status_race_test.id('l_cancelled'))); end $$;
select is((select r from dblink('worker', status_race_test.confirm_sql('l_cancelled', (select id from attempt where name = 'l_cancelled'))) t(r text)),
  'lead_cancelled', 'E: a lead cancelled by stopping the campaign is not sent to');

insert into attempt select 'l_unsubscribed', id from dblink('worker', status_race_test.claim_sql('l_unsubscribed')) t(id uuid);
do $$ begin perform dblink_exec('replier', format('update public.campaign_leads set status = %L, next_send_at = null where id = %L', 'unsubscribed', status_race_test.id('l_unsubscribed'))); end $$;
select is((select r from dblink('worker', status_race_test.confirm_sql('l_unsubscribed', (select id from attempt where name = 'l_unsubscribed'))) t(r text)),
  'lead_unsubscribed', 'F: a lead that unsubscribed after its claim is not sent to');

insert into attempt select 'l_removed', id from dblink('worker', status_race_test.claim_sql('l_removed')) t(id uuid);
do $$ begin perform dblink_exec('ctl', format('delete from public.campaign_leads where id = %L', status_race_test.id('l_removed'))); end $$;
select is((select r from dblink('worker', status_race_test.confirm_sql('l_removed', (select id from attempt where name = 'l_removed'))) t(r text)),
  'lead_removed', 'E: a lead removed from the campaign after its claim is not sent to');

insert into attempt select 'l_step_changed', id from dblink('worker', status_race_test.claim_sql('l_step_changed')) t(id uuid);
do $$ begin perform dblink_exec('ctl', format('update public.campaign_leads set current_step_id = %L where id = %L',
  status_race_test.id('l_step_changed_step2'), status_race_test.id('l_step_changed'))); end $$;
select is((select r from dblink('worker', status_race_test.confirm_sql('l_step_changed', (select id from attempt where name = 'l_step_changed'))) t(r text)),
  'step_changed', 'E: a lead no longer on the claimed step is not sent that step');

-- D: Send Now ----------------------------------------------------------------
insert into attempt select 'l_send_now', id from dblink('worker', status_race_test.claim_sql('l_send_now')) t(id uuid);
select is((select r from dblink('worker', status_race_test.confirm_sql('l_send_now', (select id from attempt where name = 'l_send_now'))) t(r text)),
  'ok', 'D: an eligible Send Now lead passes the check');
select is((status_race_test.lead('l_send_now')).send_now_step_id, status_race_test.id('l_send_now_step1'),
  'D: ...and the check leaves the Send Now bypass to the worker''s own consume');

-- G: the check refuses a stale attempt id without touching another lead's row
select is((select r from dblink('worker', format('select public.confirm_send_attempt_eligible(%L, %L, %L)',
    (select id from attempt where name = 'l_send_now'), status_race_test.id('l_reply_first'), status_race_test.id('l_reply_first_step1'))) t(r text)),
  'lead_replied', 'G: an ineligible lead with another lead''s attempt id is refused');
select is(status_race_test.attempt_status('l_send_now'), 'pending', 'G: ...and the other lead''s pending attempt is untouched');


-- Worker writes from the claimed copy (needs_review, "already sent" self-heal)
select is((select n from dblink('worker', status_race_test.guarded_sql('l_heal_ok', status_race_test.heal_set('l_heal_ok'))) t(n int)),
  1, 'self-heal: a lead still active on the claimed step is advanced');
select is((status_race_test.lead('l_heal_ok')).current_step_id, status_race_test.id('l_heal_ok_step2'), 'self-heal: ...to the next step');

do $$ begin perform dblink_exec('replier', status_race_test.reply_sql('l_heal_replied')); end $$;
select is((select n from dblink('worker', status_race_test.guarded_sql('l_heal_replied', status_race_test.heal_set('l_heal_replied'))) t(n int)),
  0, 'self-heal: a lead that replied since the claim is not advanced');
select is((status_race_test.lead('l_heal_replied')).status, 'replied', 'self-heal: ...its reply status stands');
select is((status_race_test.lead('l_heal_replied')).next_send_at, null, 'self-heal: ...and no further send is scheduled');

do $$ begin
  perform dblink_exec('replier', 'begin');
  perform dblink_exec('replier', status_race_test.reply_sql('l_heal_concurrent'));
  perform dblink_send_query('worker', status_race_test.guarded_sql('l_heal_concurrent', status_race_test.heal_set('l_heal_concurrent')));
end $$;
select ok(status_race_test.wait_until_blocked('status_race_test_worker'),
  'self-heal (concurrent): the guarded write waits on the row the uncommitted reply holds');
do $$ begin perform dblink_exec('replier', 'commit'); end $$;
select is((select n from dblink_get_result('worker') t(n int)), 0,
  'self-heal (concurrent): once the reply commits, the guard re-checks and matches nothing');
do $$ begin perform * from dblink_get_result('worker') t(n int); end $$;
select is((status_race_test.lead('l_heal_concurrent')).status, 'replied', 'self-heal (concurrent): the reply status stands');

do $$ begin perform dblink_exec('ctl', format('update public.campaign_leads set status = %L, next_send_at = null, locked_until = null where id = %L',
  'cancelled', status_race_test.id('l_review_cancelled'))); end $$;
select is((select n from dblink('worker', status_race_test.guarded_sql('l_review_cancelled', format('status = %L, locked_until = null', 'needs_review'))) t(n int)),
  0, 'needs_review: a lead stopped since the claim is not flagged');
select is((status_race_test.lead('l_review_cancelled')).status, 'cancelled', 'needs_review: ...it stays cancelled');

do $$ begin perform dblink_exec('ctl', format('delete from public.campaign_leads where id = %L', status_race_test.id('l_review_removed'))); end $$;
select is((select n from dblink('worker', status_race_test.guarded_sql('l_review_removed', format('status = %L, locked_until = null', 'needs_review'))) t(n int)),
  0, 'needs_review: a lead removed since the claim matches nothing (no error)');

-- ---------------------------------------------------------------------------
select * from finish();

do $$ begin
  perform dblink_disconnect(name) from unnest(array['worker', 'replier', 'ctl']) name;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Cleanup (committed fixtures)
-- ---------------------------------------------------------------------------
delete from public.email_events where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@status-race-test.invalid');
delete from public.suppressions where user_id in (select id from auth.users where email like '%@status-race-test.invalid');
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@status-race-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@status-race-test.invalid');
delete from auth.users where email like '%@status-race-test.invalid';
drop schema status_race_test cascade;
