-- Tests for supabase/migrations/20261113100000_crm_sequences.sql.
-- Run against the LOCAL stack only: `supabase test db`.
--
-- One transaction, rolled back. Fixtures are created as postgres; every
-- read runs as the real API role `authenticated` with that user's JWT
-- claims, exactly as PostgREST would.
--
-- User A has one campaign with two steps and four leads:
--   l1: sent step 1, a person opened it twice and clicked once, replied to step 1
--   l2: sent step 1, only a security scanner opened it
--   l3: sent step 1, never opened
--   l4: never emailed
-- User B has one lead, which A must never see.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(36);

create temp table fx (name text primary key, id uuid not null);
grant select on fx to authenticated, anon;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_campaign uuid; v_sequence uuid; v_s1 uuid; v_s2 uuid;
  v_lead uuid; v_cl uuid; v_n int;
begin
  insert into auth.users (id, email) values (v_a, 'a@crm-test.invalid'), (v_b, 'b@crm-test.invalid');
  insert into fx values ('user_a', v_a), ('user_b', v_b);

  insert into public.campaigns (user_id, name) values (v_a, 'Q4') returning id into v_campaign;
  insert into public.sequences (campaign_id, name) values (v_campaign, 'Default') returning id into v_sequence;
  insert into public.sequence_steps (sequence_id, step_order, day_delay, subject) values (v_sequence, 0, 0, 'Hi') returning id into v_s1;
  insert into public.sequence_steps (sequence_id, step_order, day_delay, subject, condition, condition_step_id)
    values (v_sequence, 1, 3, 'Bump', 'not_opened', v_s1) returning id into v_s2;
  insert into fx values ('campaign', v_campaign), ('step1', v_s1), ('step2', v_s2);

  for v_n in 1..4 loop
    insert into public.leads (user_id, email, first_name) values (v_a, 'l' || v_n || '@crm-test.invalid', 'Lead' || v_n)
      returning id into v_lead;
    insert into public.campaign_leads (campaign_id, lead_id) values (v_campaign, v_lead) returning id into v_cl;
    insert into fx values ('l' || v_n, v_lead), ('cl' || v_n, v_cl);
    if v_n <= 3 then
      insert into public.send_attempts (campaign_lead_id, sequence_step_id, status, provider_message_id, resolved_at)
        values (v_cl, v_s1, 'sent', 'msg-' || v_n || '@crm-test.invalid', now());
      insert into public.email_events (campaign_id, lead_id, event_type, provider_message_id)
        values (v_campaign, v_lead, 'sent', 'msg-' || v_n || '@crm-test.invalid');
    end if;
  end loop;

  insert into public.email_events (campaign_id, lead_id, event_type, is_bot, metadata) values
    (v_campaign, (select id from fx where name = 'l1'), 'opened', false, jsonb_build_object('sequenceStepId', v_s1)),
    (v_campaign, (select id from fx where name = 'l1'), 'opened', false, jsonb_build_object('sequenceStepId', v_s1)),
    (v_campaign, (select id from fx where name = 'l1'), 'clicked', false, jsonb_build_object('sequenceStepId', v_s1)),
    (v_campaign, (select id from fx where name = 'l1'), 'replied', false, jsonb_build_object('inReplyTo', 'msg-1@crm-test.invalid')),
    (v_campaign, (select id from fx where name = 'l2'), 'opened', true, jsonb_build_object('sequenceStepId', v_s1)),
    (v_campaign, (select id from fx where name = 'l2'), 'clicked', true, jsonb_build_object('sequenceStepId', v_s1));

  insert into public.leads (user_id, email) values (v_b, 'b-lead@crm-test.invalid') returning id into v_lead;
  insert into fx values ('b_lead', v_lead);
end $$;

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where name = p_user), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.crm(p_engagement text, p_step text default null) returns text[] language sql as $$
  select coalesce(array_agg(l.first_name order by l.first_name), '{}')
  from public.crm_leads(p_engagement, (select id from fx where name = 'campaign'), (select id from fx where name = p_step)) l
$$;

-- Structure -------------------------------------------------------------------
select has_column('public', 'email_events', 'is_bot', 'email_events.is_bot exists');
select col_default_is('public', 'email_events', 'is_bot', 'false', 'is_bot defaults to false');
select has_column('public', 'sequence_steps', 'condition', 'sequence_steps.condition exists');
select col_default_is('public', 'sequence_steps', 'condition', 'always'::text, 'condition defaults to always');
select throws_ok(
  $$update public.sequence_steps set condition = 'replied' where id = (select id from fx where name = 'step2')$$,
  '23514', null, 'an unknown condition is refused');
select throws_ok(
  $$update public.sequence_steps set condition = 'always' where id = (select id from fx where name = 'step2')$$,
  '23514', null, 'an always step cannot keep a condition step');
select is((select relrowsecurity from pg_class where oid = 'public.lead_notes'::regclass), true, 'lead_notes has RLS enabled');
select policies_are('public', 'lead_notes',
  array['lead_notes_select_own', 'lead_notes_insert_own', 'lead_notes_update_own', 'lead_notes_delete_own'],
  'lead_notes has exactly the four own-row policies');
select lives_ok(
  $$update public.leads set status = 'meeting_booked' where id = (select id from fx where name = 'l4')$$,
  'the new pipeline statuses are allowed');
select ok(not has_function_privilege('anon', 'public.crm_leads(text, uuid, uuid)', 'execute'), 'anon cannot call crm_leads');
select ok(not has_function_privilege('anon', 'public.campaign_engagement(uuid)', 'execute'), 'anon cannot call campaign_engagement');

-- Lead notes, as user A ---------------------------------------------------------
select pg_temp.act_as('user_a');
select lives_ok(
  $$insert into public.lead_notes (lead_id, user_id, body) values ((select id from fx where name = 'l1'), (select id from fx where name = 'user_a'), 'Wants a demo')$$,
  'a user can note their own lead');
select throws_ok(
  $$insert into public.lead_notes (lead_id, user_id, body) values ((select id from fx where name = 'b_lead'), (select id from fx where name = 'user_a'), 'Spy')$$,
  '42501', null, 'a user cannot note another user''s lead');
select throws_ok(
  $$insert into public.lead_notes (lead_id, user_id, body) values ((select id from fx where name = 'l1'), (select id from fx where name = 'user_a'), '   ')$$,
  '23514', null, 'a blank note is refused');

-- CRM engagement filters ----------------------------------------------------------
select is((select count(*) from public.crm_leads())::int, 4, 'crm_leads shows only the caller''s own leads');
select is(pg_temp.crm('opened'), array['Lead1'], 'opened: a person opened (a scanner open does not count)');
select is(pg_temp.crm('not_opened'), array['Lead2', 'Lead3'], 'not opened: emailed and no human open');
select is(pg_temp.crm('clicked'), array['Lead1'], 'clicked: people only');
select is(pg_temp.crm('not_clicked'), array['Lead2', 'Lead3'], 'not clicked: emailed and no human click');
select is(pg_temp.crm('replied'), array['Lead1'], 'replied');
select is(pg_temp.crm('no_engagement'), array['Lead2', 'Lead3'], 'sent, no engagement');
select is(pg_temp.crm('never_contacted'), array['Lead4'], 'never emailed');
select is(pg_temp.crm('any'), array['Lead1', 'Lead2', 'Lead3', 'Lead4'], 'any with a campaign: everyone enrolled');
select is(pg_temp.crm('not_opened', 'step1'), array['Lead2', 'Lead3'], 'did not open step 1');
select is(pg_temp.crm('not_opened', 'step2'), '{}'::text[], 'nobody was sent step 2, so nobody "didn''t open" it');
select is(pg_temp.crm('opened', 'step2'), '{}'::text[], 'nobody opened step 2');

-- Computed fields -----------------------------------------------------------------
select is(
  (select array[public.crm_sent(l), public.crm_opens(l), public.crm_clicks(l), public.crm_replies(l)]
   from public.leads l where l.id = (select id from fx where name = 'l1')),
  array[1, 2, 1, 1]::bigint[], 'per-lead counts: sent, opens, clicks, replies');
select is(
  (select public.crm_opens(l) from public.leads l where l.id = (select id from fx where name = 'l2')),
  0::bigint, 'a scanner open is not counted');
select ok(
  (select public.crm_last_activity_at(l) is null from public.leads l where l.id = (select id from fx where name = 'l4')),
  'a lead never emailed has no last activity');

-- Campaign analytics --------------------------------------------------------------
select is((public.campaign_engagement((select id from fx where name = 'campaign')) ->> 'emails_sent')::int, 3, 'emails sent from the send log');
select is((public.campaign_engagement((select id from fx where name = 'campaign')) ->> 'unique_opened')::int, 1,
  'one person opened, however many times, and the scanner is left out');
select is((public.campaign_engagement((select id from fx where name = 'campaign')) ->> 'bot_opens')::int, 1, 'the scanner open is counted separately');
select is(
  (select (step ->> 'unique_replied')::int from jsonb_array_elements(public.campaign_engagement((select id from fx where name = 'campaign')) -> 'steps') step
   where step ->> 'step_id' = (select id from fx where name = 'step1')::text),
  1, 'a reply is attributed to the step whose message it answers');
select is(
  (select (step ->> 'sent')::int from jsonb_array_elements(public.campaign_engagement((select id from fx where name = 'campaign')) -> 'steps') step
   where step ->> 'step_id' = (select id from fx where name = 'step2')::text),
  0, 'an unsent step has no sends');

-- Isolation, as user B ----------------------------------------------------------
select pg_temp.act_as('user_b');
select is((select count(*) from public.crm_leads())::int, 1, 'user B sees only their own lead');
select is((select count(*) from public.lead_notes)::int, 0, 'user B cannot read user A''s notes');

select * from finish();
rollback;
