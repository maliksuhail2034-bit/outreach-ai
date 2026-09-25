-- Regression tests for claim_due_sends()
-- (supabase/migrations/20260925100000_claim_due_sends_per_mailbox_capacity.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- Concurrency can't be tested from one session, so claims run through two
-- separate dblink sessions ("a" and "b", both as service_role — the role the
-- worker's admin client uses) plus a "ctl" session (postgres) that arranges
-- state. dblink sessions only see committed rows, so fixtures are committed
-- up front (not inside the pgTAP transaction) and deleted again at the end.
-- Every fixture user has an @claim-test.invalid email; deleting those users
-- cascades to their mailboxes/campaigns/leads/campaign_leads/email_events.
--
-- claim_due_sends() claims across ALL organizations by design, so each
-- scenario activates only its own campaign(s) — every other fixture campaign
-- is paused — and the first test asserts nothing outside the fixtures is
-- claimable in this database.
--
-- Not covered here: the final lead lock re-checking status/next_send_at when
-- another transaction COMMITS a change to that lead between the claim's
-- snapshot and its lock (all inside one statement). The claim never waits,
-- so there is no point to pause it at without a test hook or sleeps; holding
-- the row lock uncommitted instead exercises SKIP LOCKED, not the re-check.
-- lib/email/claim-due-sends-migration.test.ts pins those predicates to the
-- locking query structurally instead.

-- ---------------------------------------------------------------------------
-- Setup (committed)
-- ---------------------------------------------------------------------------
set client_min_messages = warning;

-- Children first: deleting a user straight away cascades a mailbox delete
-- whose ON DELETE SET NULL on campaign_leads.mailbox_id then trips
-- check_campaign_lead_owner() for a campaign the same cascade already removed.

delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@claim-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@claim-test.invalid');
delete from auth.users where email like '%@claim-test.invalid';
drop schema if exists claim_test cascade;
create schema claim_test;

create table claim_test.fx (name text primary key, kind text not null, scenario text, id uuid not null);

create function claim_test.id(p_name text) returns uuid
language sql stable as $$ select id from claim_test.fx where name = p_name $$;

create function claim_test.add_user(p_name text) returns void
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, p_name || '@claim-test.invalid');
  insert into claim_test.fx values (p_name, 'user', null, v_id);
end $$;

create function claim_test.add_mailbox(p_name text, p_scenario text, p_user text,
  p_hourly integer, p_daily integer, p_cooldown integer default 0, p_status text default 'active') returns void
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.mailboxes (user_id, email, smtp_host, smtp_username, encrypted_smtp_password,
    hourly_limit, daily_limit, cooldown_minutes, status)
  values (claim_test.id(p_user), p_name || '@claim-test.invalid', 'smtp.claim-test.invalid', p_name, 'x',
    p_hourly, p_daily, p_cooldown, p_status)
  returning id into v_id;
  insert into claim_test.fx values (p_name, 'mailbox', p_scenario, v_id);
end $$;

-- Campaigns start paused; claim_test.use_scenario() activates them.
create function claim_test.add_campaign(p_name text, p_scenario text, p_user text, p_daily integer) returns void
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.campaigns (user_id, name, status, daily_limit)
  values (claim_test.id(p_user), p_name, 'paused', p_daily)
  returning id into v_id;
  insert into claim_test.fx values (p_name, 'campaign', p_scenario, v_id);
end $$;

-- p_due is relative to now(): negative = overdue, positive = not yet due.
create function claim_test.add_lead(p_name text, p_campaign text, p_mailbox text, p_due interval,
  p_status text default 'active') returns void
language plpgsql as $$
declare
  v_owner uuid := (select user_id from public.campaigns where id = claim_test.id(p_campaign));
  v_lead uuid;
  v_id uuid;
begin
  insert into public.leads (user_id, email) values (v_owner, p_name || '@claim-test.invalid') returning id into v_lead;
  insert into public.campaign_leads (campaign_id, lead_id, mailbox_id, status, next_send_at)
  values (claim_test.id(p_campaign), v_lead, claim_test.id(p_mailbox), p_status, now() + p_due)
  returning id into v_id;
  insert into claim_test.fx values (p_name, 'campaign_lead', null, v_id);
end $$;

-- A historical 'sent' event for a campaign/mailbox at p_at, attached to a
-- throwaway lead so it never affects any claimable campaign_lead.
create function claim_test.add_sent(p_campaign text, p_mailbox text, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_owner uuid := (select user_id from public.campaigns where id = claim_test.id(p_campaign));
  v_lead uuid;
begin
  insert into public.leads (user_id, email)
  values (v_owner, 'history-' || gen_random_uuid() || '@claim-test.invalid') returning id into v_lead;
  insert into public.email_events (campaign_id, lead_id, mailbox_id, event_type, created_at)
  values (claim_test.id(p_campaign), v_lead, claim_test.id(p_mailbox), 'sent', p_at);
end $$;

create procedure claim_test.use_scenario(p_scenario text)
language sql as $$
  update public.campaigns c
  set status = case when f.scenario = p_scenario then 'active' else 'paused' end
  from claim_test.fx f
  where f.kind = 'campaign' and f.id = c.id;
$$;

create function claim_test.claim(p_limit integer) returns setof uuid
language sql as $$ select id from public.claim_due_sends(p_limit) $$;

-- Repeatedly claims and "sends" everything claimable, in one transaction.
-- Each send reproduces record_send_success()'s effects that matter to the
-- claim: a 'sent' email_events row plus clearing the lease, atomically.
-- Returns how many sends happened.
create function claim_test.drain() returns integer
language plpgsql as $$
declare
  v_total integer := 0;
  v_row public.campaign_leads;
  v_claimed integer;
begin
  for i in 1..1000 loop
    v_claimed := 0;
    for v_row in select * from public.claim_due_sends(25) loop
      insert into public.email_events (campaign_id, lead_id, mailbox_id, event_type)
      values (v_row.campaign_id, v_row.lead_id, v_row.mailbox_id, 'sent');
      update public.campaign_leads
      set status = 'completed', next_send_at = null, locked_until = null
      where id = v_row.id;
      v_claimed := v_claimed + 1;
    end loop;
    v_total := v_total + v_claimed;
    exit when v_claimed = 0;
  end loop;
  return v_total;
end $$;

-- dblink over the server's network address: loopback connections here use
-- trust auth, which dblink refuses for a non-superuser.
create function claim_test.conn_str() returns text
language plpgsql stable as $$
begin
  if inet_server_addr() is null then
    raise exception 'claim_due_sends tests must connect over TCP (run via `supabase test db`)';
  end if;
  return format('host=%s port=%s dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), inet_server_port(), current_database());
end $$;

grant usage on schema claim_test to service_role;
grant select on claim_test.fx to service_role;
grant execute on all functions in schema claim_test to service_role;

do $fixtures$
begin
  perform claim_test.add_user('org_a');
  perform claim_test.add_user('org_b');

  -- s1: the production reproduction — 1 mailbox (hourly 10 / daily 50),
  -- campaign daily 30, 25 overdue leads.
  perform claim_test.add_mailbox('s1_mb', 's1', 'org_a', 10, 50);
  perform claim_test.add_campaign('s1_c', 's1', 'org_a', 30);
  for i in 1..25 loop
    perform claim_test.add_lead('s1_l' || i, 's1_c', 's1_mb', make_interval(mins => -60 + i));
  end loop;

  -- s2: mailbox daily limit 5, already 3 sent today, 6 overdue leads.
  perform claim_test.add_mailbox('s2_mb', 's2', 'org_a', 100, 5);
  perform claim_test.add_campaign('s2_c', 's2', 'org_a', 100);
  perform claim_test.add_sent('s2_c', 's2_mb', date_trunc('day', now()));
  perform claim_test.add_sent('s2_c', 's2_mb', date_trunc('day', now()));
  perform claim_test.add_sent('s2_c', 's2_mb', date_trunc('day', now()));
  for i in 1..6 loop
    perform claim_test.add_lead('s2_l' || i, 's2_c', 's2_mb', make_interval(mins => -60 + i));
  end loop;

  -- s3: campaign daily limit 3 with 1 already sent today, spread over 5
  -- mailboxes with one overdue lead each.
  perform claim_test.add_campaign('s3_c', 's3', 'org_a', 3);
  for i in 1..5 loop
    perform claim_test.add_mailbox('s3_mb' || i, 's3', 'org_a', 100, 100);
    perform claim_test.add_lead('s3_l' || i, 's3_c', 's3_mb' || i, make_interval(mins => -60 + i));
  end loop;
  perform claim_test.add_sent('s3_c', 's3_mb1', date_trunc('day', now()));

  -- s4: 4 independent mailboxes x 3 overdue leads, generous limits.
  perform claim_test.add_campaign('s4_c', 's4', 'org_a', 100);
  for m in 1..4 loop
    perform claim_test.add_mailbox('s4_mb' || m, 's4', 'org_a', 10, 100);
    for i in 1..3 loop
      perform claim_test.add_lead('s4_l' || m || '_' || i, 's4_c', 's4_mb' || m, make_interval(mins => -60 + m * 5 + i));
    end loop;
  end loop;

  -- s5: cooldown. s5_mb (30 min cooldown, never sent) has 3 overdue leads;
  -- s5_mb_recent (30 min cooldown) sent 10 minutes ago.
  perform claim_test.add_campaign('s5_c', 's5', 'org_a', 100);
  perform claim_test.add_mailbox('s5_mb', 's5', 'org_a', 100, 100, 30);
  perform claim_test.add_mailbox('s5_mb_recent', 's5', 'org_a', 100, 100, 30);
  for i in 1..3 loop
    perform claim_test.add_lead('s5_l' || i, 's5_c', 's5_mb', make_interval(mins => -60 + i));
  end loop;
  perform claim_test.add_lead('s5_recent_l', 's5_c', 's5_mb_recent', interval '-60 minutes');
  perform claim_test.add_sent('s5_c', 's5_mb_recent', now() - interval '10 minutes');

  -- s6: lease behavior on one mailbox.
  perform claim_test.add_campaign('s6_c', 's6', 'org_a', 100);
  perform claim_test.add_mailbox('s6_mb', 's6', 'org_a', 100, 100);
  perform claim_test.add_lead('s6_leased', 's6_c', 's6_mb', interval '-2 hours');
  perform claim_test.add_lead('s6_waiting', 's6_c', 's6_mb', interval '-1 hour');

  -- s7: two organizations, one overdue lead each.
  perform claim_test.add_campaign('s7_c_a', 's7', 'org_a', 100);
  perform claim_test.add_campaign('s7_c_b', 's7', 'org_b', 100);
  perform claim_test.add_mailbox('s7_mb_a', 's7', 'org_a', 100, 100);
  perform claim_test.add_mailbox('s7_mb_b', 's7', 'org_b', 100, 100);
  perform claim_test.add_lead('s7_l_a', 's7_c_a', 's7_mb_a', interval '-2 hours');
  perform claim_test.add_lead('s7_l_b', 's7_c_b', 's7_mb_b', interval '-1 hour');

  -- s8: overlapping claims on ONE mailbox shared by two campaigns (a pooled
  -- mailbox — see campaign_mailboxes). s8_c2 stays paused until after
  -- invocation A has claimed, so A never locks it.
  perform claim_test.add_campaign('s8_c1', 's8', 'org_a', 100);
  perform claim_test.add_campaign('s8_c2', 's8_resumed_later', 'org_a', 100);
  perform claim_test.add_mailbox('s8_mb', 's8', 'org_a', 100, 100);
  perform claim_test.add_lead('s8_early', 's8_c1', 's8_mb', interval '-1 hour');
  perform claim_test.add_lead('s8_late', 's8_c2', 's8_mb', interval '-30 minutes');

  -- s9: overlapping claims on ONE campaign (daily limit 1) across 2 mailboxes.
  perform claim_test.add_campaign('s9_c', 's9', 'org_a', 1);
  perform claim_test.add_mailbox('s9_mb1', 's9', 'org_a', 100, 100);
  perform claim_test.add_mailbox('s9_mb2', 's9', 'org_a', 100, 100);
  perform claim_test.add_lead('s9_l1', 's9_c', 's9_mb1', interval '-2 hours');
  perform claim_test.add_lead('s9_l2', 's9_c', 's9_mb2', interval '-1 hour');

  -- s10: pre-existing eligibility predicates. Only s10_ok is claimable.
  perform claim_test.add_campaign('s10_c', 's10', 'org_a', 100);
  perform claim_test.add_campaign('s10_c_paused', 's10_never_active', 'org_a', 100);
  perform claim_test.add_mailbox('s10_mb_ok', 's10', 'org_a', 100, 100);
  perform claim_test.add_mailbox('s10_mb_future', 's10', 'org_a', 100, 100);
  perform claim_test.add_mailbox('s10_mb_review', 's10', 'org_a', 100, 100);
  perform claim_test.add_mailbox('s10_mb_inactive', 's10', 'org_a', 100, 100, 0, 'paused');
  perform claim_test.add_mailbox('s10_mb_paused_c', 's10', 'org_a', 100, 100);
  perform claim_test.add_mailbox('s10_mb_null', 's10', 'org_a', 100, 100);
  perform claim_test.add_lead('s10_ok', 's10_c', 's10_mb_ok', interval '-1 hour');
  perform claim_test.add_lead('s10_future', 's10_c', 's10_mb_future', interval '1 hour');
  perform claim_test.add_lead('s10_review', 's10_c', 's10_mb_review', interval '-1 hour', 'needs_review');
  perform claim_test.add_lead('s10_inactive_mb', 's10_c', 's10_mb_inactive', interval '-1 hour');
  perform claim_test.add_lead('s10_paused_campaign', 's10_c_paused', 's10_mb_paused_c', interval '-1 hour');
  perform claim_test.add_lead('s10_no_mailbox', 's10_c', 's10_mb_null', interval '-1 hour');
  update public.campaign_leads set mailbox_id = null where id = claim_test.id('s10_no_mailbox');
end
$fixtures$;

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

select plan(34);

do $$
begin
  perform dblink_connect('ctl', claim_test.conn_str());
  perform dblink_connect('a', claim_test.conn_str());
  perform dblink_connect('b', claim_test.conn_str());
  perform dblink_exec('a', 'set role service_role');
  perform dblink_exec('b', 'set role service_role');
  -- A claim that blocked instead of skipping would fail its test loudly.
  perform dblink_exec('a', 'set statement_timeout = ''5s''');
  perform dblink_exec('b', 'set statement_timeout = ''5s''');
end $$;

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.claimable_due_sends(uuid[])', 'execute'),
  'claimable_due_sends is not executable by anon');
select ok(not has_function_privilege('authenticated', 'public.claimable_due_sends(uuid[])', 'execute'),
  'claimable_due_sends is not executable by authenticated');
select ok(has_function_privilege('service_role', 'public.claimable_due_sends(uuid[])', 'execute'),
  'claimable_due_sends is executable by service_role (claim_due_sends is security invoker)');

select is((select count(*)::int from dblink('b', 'select * from claim_test.claim(1000)') t(id uuid)), 0,
  'nothing is claimable while every fixture campaign is paused (no outside data interferes)');

-- s1: production reproduction ------------------------------------------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s1'')');
  perform dblink_exec('a', 'begin');
end $$;
select is((select count(*)::int from dblink('a', 'select * from claim_test.claim(25)') t(id uuid)), 1,
  's1: 25 due leads on one mailbox -> one claim takes exactly 1 (was 25)');
do $$ begin perform dblink_exec('a', 'rollback'); end $$;
select is((select n from dblink('b', 'select claim_test.drain()') t(n int)), 10,
  's1: claim/send until empty sends exactly the mailbox hourly_limit (10)');
select is((select count(*)::int from public.campaign_leads cl join claim_test.fx f on f.id = cl.campaign_id
    where f.name = 's1_c' and cl.status = 'active'), 15,
  's1: the other 15 leads stay queued, unchanged');
select is((select count(*)::int from public.campaign_leads cl join claim_test.fx f on f.id = cl.campaign_id
    where f.name = 's1_c' and cl.locked_until is not null), 0,
  's1: no lease left behind on queued leads');

-- s2: mailbox daily limit ----------------------------------------------------
do $$ begin perform dblink_exec('ctl', 'call claim_test.use_scenario(''s2'')'); end $$;
select is((select n from dblink('b', 'select claim_test.drain()') t(n int)), 2,
  's2: mailbox daily_limit 5 with 3 sent today -> exactly 2 more sends');
select is((select count(*)::int from public.email_events
    where mailbox_id = claim_test.id('s2_mb') and event_type = 'sent' and created_at >= date_trunc('day', now())), 5,
  's2: mailbox ends the day exactly at its daily_limit');

-- s3: campaign daily limit across one batch ---------------------------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s3'')');
  perform dblink_exec('a', 'begin');
end $$;
create temp table s3_claim as
  select id from dblink('a', 'select * from claim_test.claim(25)') t(id uuid);
select is((select count(*)::int from s3_claim), 2,
  's3: campaign daily_limit 3 with 1 sent -> one batch over 5 mailboxes claims exactly 2');
select is((select count(distinct cl.mailbox_id)::int from s3_claim s join public.campaign_leads cl on cl.id = s.id), 2,
  's3: the 2 claimed leads are on different mailboxes');
do $$ begin perform dblink_exec('a', 'rollback'); end $$;
select is((select n from dblink('b', 'select claim_test.drain()') t(n int)), 2,
  's3: claim/send until empty never exceeds the campaign daily_limit');

-- s4: independent mailboxes are claimed together ----------------------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s4'')');
  perform dblink_exec('a', 'begin');
end $$;
create temp table s4_claim as
  select id from dblink('a', 'select * from claim_test.claim(25)') t(id uuid);
select is((select count(*)::int from s4_claim), 4,
  's4: 4 mailboxes x 3 due leads -> one batch claims 4');
select is((select count(distinct cl.mailbox_id)::int from s4_claim s join public.campaign_leads cl on cl.id = s.id), 4,
  's4: exactly one lead per mailbox');
select set_eq('select id from s4_claim',
  $$select claim_test.id(n) from unnest(array['s4_l1_1','s4_l2_1','s4_l3_1','s4_l4_1']) n$$,
  's4: each mailbox claims its earliest-due lead (next_send_at order preserved)');
do $$ begin perform dblink_exec('a', 'rollback'); end $$;
select is((select count(*)::int from dblink('a', 'select * from claim_test.claim(2)') t(id uuid)), 2,
  's4: p_limit still caps the batch');
do $$ begin perform dblink_exec('ctl', 'update public.campaign_leads set locked_until = null where campaign_id = claim_test.id(''s4_c'')'); end $$;
select is((select n from dblink('b', 'select claim_test.drain()') t(n int)), 12,
  's4: all 12 leads send when limits allow (no lost leads)');

-- s5: cooldown ---------------------------------------------------------------
do $$ begin perform dblink_exec('ctl', 'call claim_test.use_scenario(''s5'')'); end $$;
select is((select n from dblink('b', 'select claim_test.drain()') t(n int)), 1,
  's5: a 30 minute cooldown allows exactly one send from s5_mb and none from s5_mb_recent');
select is((select count(*)::int from public.email_events
    where mailbox_id = claim_test.id('s5_mb_recent') and created_at > now() - interval '5 minutes'), 0,
  's5: the mailbox that sent 10 minutes ago stays in cooldown');

-- s6: lease (locked_until) behavior -----------------------------------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s6'')');
  perform dblink_exec('ctl', 'update public.campaign_leads set locked_until = now() + interval ''5 minutes'' where id = claim_test.id(''s6_leased'')');
end $$;
select is((select count(*)::int from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), 0,
  's6: a live lease on one lead blocks every other lead on that mailbox');
do $$ begin
  perform dblink_exec('ctl', 'update public.campaign_leads set locked_until = now() - interval ''1 minute'' where id = claim_test.id(''s6_leased'')');
end $$;
select is((select id from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), claim_test.id('s6_leased'),
  's6: an expired lease is reclaimable (crash recovery unchanged)');
select ok((select locked_until between now() + interval '9 minutes' and now() + interval '11 minutes'
    from public.campaign_leads where id = claim_test.id('s6_leased')),
  's6: a claim still sets the 10 minute lease');

-- s7: multi-org, overlapping claims don't serialize each other --------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s7'')');
  perform dblink_exec('a', 'begin');
end $$;
select is((select id from dblink('a', 'select * from claim_test.claim(1)') t(id uuid)), claim_test.id('s7_l_a'),
  's7: invocation A claims org A''s lead and holds its locks');
select is((select id from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), claim_test.id('s7_l_b'),
  's7: overlapping invocation B still claims org B''s lead without waiting on A');
do $$ begin perform dblink_exec('a', 'commit'); end $$;
select is((select c.user_id from public.campaigns c join public.campaign_leads cl on cl.campaign_id = c.id
    where cl.id = claim_test.id('s7_l_b')), claim_test.id('org_b'),
  's7: each claimed lead stays with its own organization''s campaign');

-- s8: overlapping claims on one mailbox -------------------------------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s8'')');
  perform dblink_exec('a', 'begin');
end $$;
select is((select id from dblink('a', 'select * from claim_test.claim(25)') t(id uuid)), claim_test.id('s8_early'),
  's8: invocation A claims the earliest lead on the mailbox (uncommitted)');
-- Between A's claim and B's, the mailbox's other campaign is resumed. A
-- never saw (or locked) that campaign, and B's snapshot can't see A's
-- uncommitted claim, so B's only obstacle to a second concurrent send
-- through this mailbox is the mailbox lock.
do $$ begin
  perform dblink_exec('ctl', 'update public.campaigns set status = ''active'' where id = claim_test.id(''s8_c2'')');
end $$;
select is((select count(*)::int from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), 0,
  's8: overlapping invocation B claims nothing on a mailbox A holds');
do $$ begin perform dblink_exec('a', 'commit'); end $$;
select is((select count(*)::int from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), 0,
  's8: after A commits, the mailbox has a send in flight, so B still claims nothing');
select is((select count(*)::int from public.campaign_leads
    where mailbox_id = claim_test.id('s8_mb') and locked_until > now()), 1,
  's8: exactly one lead in flight for the mailbox');

-- s9: overlapping claims on one campaign across mailboxes -------------------
do $$ begin
  perform dblink_exec('ctl', 'call claim_test.use_scenario(''s9'')');
  perform dblink_exec('a', 'begin');
end $$;
select is((select id from dblink('a', 'select * from claim_test.claim(1)') t(id uuid)), claim_test.id('s9_l1'),
  's9: invocation A spends the campaign''s only daily send (uncommitted)');
select is((select count(*)::int from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), 0,
  's9: overlapping invocation B cannot spend it again through the campaign''s other mailbox');
do $$ begin perform dblink_exec('a', 'commit'); end $$;
select is((select count(*)::int from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)), 0,
  's9: after A commits, the in-flight send counts against the campaign daily_limit');

-- s10: pre-existing eligibility predicates ----------------------------------
do $$ begin perform dblink_exec('ctl', 'call claim_test.use_scenario(''s10'')'); end $$;
select is((select array_agg(id) from dblink('b', 'select * from claim_test.claim(25)') t(id uuid)),
  array[claim_test.id('s10_ok')],
  's10: not-yet-due, non-active lead, inactive mailbox, paused campaign and null mailbox are all still excluded');

-- ---------------------------------------------------------------------------
select * from finish();

do $$ begin
  perform dblink_disconnect('ctl');
  perform dblink_disconnect('a');
  perform dblink_disconnect('b');
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Cleanup (committed fixtures)
-- ---------------------------------------------------------------------------
-- Children first: deleting a user straight away cascades a mailbox delete
-- whose ON DELETE SET NULL on campaign_leads.mailbox_id then trips
-- check_campaign_lead_owner() for a campaign the same cascade already removed.
delete from public.campaign_leads where campaign_id in (
  select c.id from public.campaigns c join auth.users u on u.id = c.user_id where u.email like '%@claim-test.invalid');
delete from public.campaigns where user_id in (select id from auth.users where email like '%@claim-test.invalid');
delete from auth.users where email like '%@claim-test.invalid';
drop schema claim_test cascade;
