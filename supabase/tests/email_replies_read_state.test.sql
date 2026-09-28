-- Tests for email_replies access and read state
-- (supabase/migrations/20260928120000_email_replies_read_state.sql, on top of
-- 20260920100000_email_replies.sql). Run against the LOCAL stack only:
-- `supabase test db`.
--
-- Same structure as lead_segments.test.sql: one transaction, rolled back.
-- Fixtures (two users, each with a mailbox, campaign, lead and 'replied'
-- email_events rows) are created as postgres; every access check then runs
-- as the real API role — authenticated with that user's JWT claims, anon, or
-- service_role — exactly as PostgREST would.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(32);

-- Fixtures ------------------------------------------------------------------
create temp table fx (name text primary key, id uuid not null);
grant select on fx to authenticated, anon, service_role;
create temp table affected (op text, n int);
grant select, insert on affected to authenticated;

-- A user with a mailbox, a campaign and a lead, plus p_replies 'replied'
-- events. Events 1..p_stored get a stored email_replies row ('<user>_reply1',
-- ...); the rest are left for service_role to insert. The first stored reply
-- is unread, any further ones are already read.
create function pg_temp.add_user(p_user text, p_replies int, p_stored int) returns void
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
  v_mailbox uuid; v_campaign uuid; v_lead uuid; v_event uuid; v_reply uuid;
begin
  insert into auth.users (id, email) values (v_user, p_user || '@inbox-read-test.invalid');
  insert into public.mailboxes (user_id, email, display_name, smtp_host, smtp_username, encrypted_smtp_password, hourly_limit, daily_limit)
  values (v_user, p_user || '-mb@inbox-read-test.invalid', initcap(p_user) || ' Sales', 'smtp.inbox-read-test.invalid', p_user, 'x', 100, 100)
  returning id into v_mailbox;
  insert into public.campaigns (user_id, name) values (v_user, initcap(p_user) || ' Q4 outreach') returning id into v_campaign;
  insert into public.leads (user_id, email, first_name, last_name, company)
  values (v_user, p_user || '-lead@inbox-read-test.invalid', 'Dana', initcap(p_user), 'Acme') returning id into v_lead;
  insert into fx values (p_user, v_user), (p_user || '_mailbox', v_mailbox), (p_user || '_campaign', v_campaign), (p_user || '_lead', v_lead);

  for i in 1..p_replies loop
    insert into public.email_events (campaign_id, lead_id, mailbox_id, event_type, provider_message_id)
    values (v_campaign, v_lead, v_mailbox, 'replied', '<' || p_user || '-' || i || '@inbox-read-test.invalid>')
    returning id into v_event;
    insert into fx values (p_user || '_event' || i, v_event);

    if i <= p_stored then
      insert into public.email_replies (email_event_id, campaign_id, lead_id, mailbox_id, subject, from_email, from_name,
        to_emails, body_text, body_html, received_at, read_at)
      values (v_event, v_campaign, v_lead, v_mailbox, 'Re: Quick question', p_user || '-lead@inbox-read-test.invalid',
        'Dana ' || initcap(p_user), array[p_user || '-mb@inbox-read-test.invalid'],
        'Sounds interesting — can we talk Tuesday?', '<p>Sounds interesting</p>', now() - make_interval(hours => i),
        case when i = 1 then null else now() - interval '1 hour' end)
      returning id into v_reply;
      insert into fx values (p_user || '_reply' || i, v_reply);
    end if;
  end loop;
end $$;

-- user_a: two stored replies (reply1 unread, reply2 read) and one replied
-- event with no stored reply yet. user_b: one stored, unread reply.
select pg_temp.add_user('user_a', 3, 2);
select pg_temp.add_user('user_b', 1, 1);

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where name = p_user), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.fx(p_name text) returns uuid language sql stable as $$
  select id from fx where name = p_name
$$;

-- Structure -----------------------------------------------------------------
select col_type_is('public', 'email_replies', 'read_at', 'timestamp with time zone', 'read_at is timestamptz');
select col_is_null('public', 'email_replies', 'read_at', 'read_at is nullable (null = unread)');
select policies_are('public', 'email_replies', array['email_replies_select_own', 'email_replies_update_own'],
  'exactly the owner select and update policies — no insert/delete policy');
select is((select tgenabled from pg_trigger where tgname = 'email_replies_check_owner' and tgrelid = 'public.email_replies'::regclass),
  'O', 'the check_email_reply_owner trigger is still present and enabled');

-- Privileges (explicit, not environment defaults) -----------------------------
select ok(has_column_privilege('authenticated', 'public.email_replies', 'read_at', 'update'),
  'authenticated may update read_at');
select ok(not has_table_privilege('authenticated', 'public.email_replies', 'update'),
  'authenticated has no table-wide UPDATE (which would cover every column)');
select ok(not has_table_privilege('anon', 'public.email_replies', 'select')
  and not has_table_privilege('anon', 'public.email_replies', 'update'), 'anon has no access to email_replies at all');

-- As the owner (user A) ------------------------------------------------------
select pg_temp.act_as('user_a');
select is((select count(*)::int from public.email_replies where id = pg_temp.fx('user_a_reply1')), 1,
  'an owner can select their own reply');
select is((select count(*)::int from public.email_replies), 2, 'an owner sees exactly their own two replies');
select is((select count(*)::int from public.email_replies where read_at is null), 1,
  'the unread count is scoped to the caller''s own replies (1, not the 2 unread across both users)');

select lives_ok(
  $$update public.email_replies set read_at = '2026-09-28 12:00:00+00' where id = pg_temp.fx('user_a_reply1')$$,
  'an owner can update read_at (the update passes check_email_reply_owner, which runs on every update)');
reset role;
select is((select read_at from public.email_replies where id = pg_temp.fx('user_a_reply1')), '2026-09-28 12:00:00+00'::timestamptz,
  '...and the new read_at was actually stored');
select pg_temp.act_as('user_a');
select is((select count(*)::int from public.email_replies where read_at is null), 0, 'user A now has no unread replies');

select throws_ok(
  $$update public.email_replies set body_text = 'Tampered' where id = pg_temp.fx('user_a_reply1')$$,
  '42501', null, 'an owner cannot update body_text');
select throws_ok(
  $$update public.email_replies set campaign_id = pg_temp.fx('user_b_campaign') where id = pg_temp.fx('user_a_reply1')$$,
  '42501', null, 'an owner cannot update campaign_id');
select throws_ok(
  $$update public.email_replies set lead_id = pg_temp.fx('user_b_lead') where id = pg_temp.fx('user_a_reply1')$$,
  '42501', null, 'an owner cannot update lead_id');
select throws_ok(
  $$update public.email_replies set mailbox_id = pg_temp.fx('user_b_mailbox') where id = pg_temp.fx('user_a_reply1')$$,
  '42501', null, 'an owner cannot update mailbox_id');
select throws_ok(
  $$insert into public.email_replies (email_event_id, campaign_id, lead_id, mailbox_id, from_email, received_at)
    values (pg_temp.fx('user_a_event3'), pg_temp.fx('user_a_campaign'), pg_temp.fx('user_a_lead'), pg_temp.fx('user_a_mailbox'),
      'user_a-lead@inbox-read-test.invalid', now())$$,
  '42501', null, 'an authenticated user cannot insert replies, even for their own event');
select throws_ok(
  $$delete from public.email_replies where id = pg_temp.fx('user_a_reply2')$$,
  '42501', null, 'an authenticated user cannot delete replies, even their own');

-- Cross-user isolation (user B) ----------------------------------------------
reset role;
select pg_temp.act_as('user_b');
select is((select count(*)::int from public.email_replies where campaign_id = pg_temp.fx('user_a_campaign')), 0,
  'another user cannot select user A''s replies');
select is((select count(*)::int from public.email_replies where read_at is null), 1,
  'user B''s unread count is their own single reply');
do $$
declare n int;
begin
  update public.email_replies set read_at = now() where campaign_id = (select id from fx where name = 'user_a_campaign');
  get diagnostics n = row_count;
  insert into affected values ('update', n);
end $$;
select is((select n from affected where op = 'update'), 0, 'another user cannot update read_at on user A''s replies');
reset role;
select is((select read_at from public.email_replies where id = pg_temp.fx('user_a_reply2')), now() - interval '1 hour',
  '...and user A''s already-read reply keeps its original read_at');
select is((select count(*)::int from public.email_replies where id = pg_temp.fx('user_b_reply1') and read_at is null), 1,
  '...and user B''s own reply is untouched by that attempt');

-- Anonymous -----------------------------------------------------------------
set local role anon;
select throws_ok($$select count(*) from public.email_replies$$, '42501', null, 'anon cannot select replies');
select throws_ok(
  $$update public.email_replies set read_at = now() where id = (select id from fx where name = 'user_a_reply1')$$,
  '42501', null, 'anon cannot update read_at');
reset role;

-- service_role (the reply-sync worker's admin client) --------------------------
set local role service_role;
select is((select count(*)::int from public.email_replies where campaign_id in (pg_temp.fx('user_a_campaign'), pg_temp.fx('user_b_campaign'))), 3,
  'service_role can select every user''s replies');
select lives_ok(
  $$insert into public.email_replies (email_event_id, campaign_id, lead_id, mailbox_id, subject, from_email, from_name, to_emails,
      body_text, received_at)
    values (pg_temp.fx('user_a_event3'), pg_temp.fx('user_a_campaign'), pg_temp.fx('user_a_lead'), pg_temp.fx('user_a_mailbox'),
      'Re: Quick question', 'user_a-lead@inbox-read-test.invalid', 'Dana User_a', array['user_a-mb@inbox-read-test.invalid'],
      'Following up on my last note.', now())$$,
  'service_role can insert a reply (passing check_email_reply_owner)');
select is((select read_at from public.email_replies where email_event_id = pg_temp.fx('user_a_event3')), null::timestamptz,
  'a newly synced reply starts unread');
select throws_ok(
  $$insert into public.email_replies (email_event_id, campaign_id, lead_id, mailbox_id, from_email, received_at)
    values (pg_temp.fx('user_b_event1'), pg_temp.fx('user_a_campaign'), pg_temp.fx('user_b_lead'), pg_temp.fx('user_b_mailbox'),
      'user_b-lead@inbox-read-test.invalid', now())$$,
  'P0001', 'email_replies.campaign_id must match the referenced email_events row''s campaign_id',
  'the owner-consistency trigger still guards service_role inserts');
reset role;

-- The newly synced reply shows up as unread for its owner only.
select pg_temp.act_as('user_a');
select is((select count(*)::int from public.email_replies where read_at is null), 1,
  'user A sees the newly synced reply as their one unread reply');
reset role;
select pg_temp.act_as('user_b');
select is((select count(*)::int from public.email_replies where read_at is null), 1,
  'user B''s unread count is unchanged by user A''s new reply');
reset role;

select * from finish();
rollback;
