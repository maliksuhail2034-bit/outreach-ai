-- Tests for lead_segments (supabase/migrations/20260926130000_lead_segments.sql).
-- Run against the LOCAL stack only: `supabase test db`.
--
-- One transaction, rolled back: fixtures (two users, one list each) are
-- created as postgres, then every ownership check runs as the real API role
-- `authenticated` with that user's JWT claims, exactly as PostgREST would.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(27);

-- Fixtures ------------------------------------------------------------------
create temp table fx (name text primary key, id uuid not null);
grant select on fx to authenticated, anon;
create temp table affected (op text, n int);
grant select, insert on affected to authenticated;

do $$
declare v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_list_a uuid; v_list_b uuid;
begin
  insert into auth.users (id, email) values (v_a, 'a@lead-segments-test.invalid'), (v_b, 'b@lead-segments-test.invalid');
  insert into public.lead_lists (user_id, name) values (v_a, 'A list') returning id into v_list_a;
  insert into public.lead_lists (user_id, name) values (v_b, 'B list') returning id into v_list_b;
  insert into fx values ('user_a', v_a), ('user_b', v_b), ('list_a', v_list_a), ('list_b', v_list_b);
end $$;

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from fx where name = p_user), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.status_rule() returns jsonb language sql as $$
  select '[{"field": "status", "operator": "is", "value": "new"}]'::jsonb
$$;

create function pg_temp.list_rule(p_list text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('field', 'list_id', 'operator', 'in',
    'values', jsonb_build_array((select id from fx where name = p_list))))
$$;

-- Structure -----------------------------------------------------------------
select has_table('public', 'lead_segments', 'lead_segments exists');
select is((select relrowsecurity from pg_class where oid = 'public.lead_segments'::regclass), true, 'RLS is enabled');
select policies_are('public', 'lead_segments',
  array['lead_segments_select_own', 'lead_segments_insert_own', 'lead_segments_update_own', 'lead_segments_delete_own'],
  'exactly the four own-row policies');
select fk_ok('public', 'lead_segments', 'user_id', 'auth', 'users', 'id', 'user_id references auth.users');
select has_index('public', 'lead_segments', 'lead_segments_user_id_idx', 'user_id is indexed');
select has_trigger('public', 'lead_segments', 'lead_segments_set_updated_at', 'updated_at is maintained by trigger');
select ok(
  (select bool_and(qual like '%auth.uid() = user_id%' or with_check like '%auth.uid() = user_id%')
   from pg_policies where tablename = 'lead_segments'),
  'every policy is scoped to auth.uid() = user_id');

-- Ownership, as user A --------------------------------------------------------
select pg_temp.act_as('user_a');
select lives_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_a'), 'A segment', pg_temp.status_rule())$$,
  'a user can create their own segment');
select lives_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_a'), 'A list segment', pg_temp.list_rule('list_a'))$$,
  'a segment can reference the user''s own list');
select throws_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_b'), 'Planted', pg_temp.status_rule())$$,
  '42501', null,
  'a user cannot create a segment owned by someone else');
select throws_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_a'), 'Foreign list', pg_temp.list_rule('list_b'))$$,
  '42501', 'lead_segments.rules may only reference lead lists owned by the same user',
  'a segment cannot reference another user''s list');
select throws_ok(
  $$update public.lead_segments set rules = pg_temp.list_rule('list_b') where name = 'A segment'$$,
  '42501', 'lead_segments.rules may only reference lead lists owned by the same user',
  'an update cannot switch a segment to another user''s list');
select throws_ok(
  $$update public.lead_segments set user_id = (select id from fx where name = 'user_b') where name = 'A segment'$$,
  '42501', null,
  'a user cannot hand a segment to someone else');
select is((select count(*)::int from public.lead_segments), 2, 'user A sees exactly their two segments');

-- Cross-user isolation, as user B --------------------------------------------
reset role;
select pg_temp.act_as('user_b');
select is((select count(*)::int from public.lead_segments), 0, 'user B cannot see user A''s segments');
do $$
declare n int;
begin
  update public.lead_segments set name = 'Hijacked';
  get diagnostics n = row_count;
  insert into affected values ('update', n);
  delete from public.lead_segments;
  get diagnostics n = row_count;
  insert into affected values ('delete', n);
end $$;
select is((select n from affected where op = 'update'), 0, 'user B cannot update user A''s segments');
select is((select n from affected where op = 'delete'), 0, 'user B cannot delete user A''s segments');
select throws_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_b'), 'Peek', pg_temp.list_rule('list_a'))$$,
  '42501', 'lead_segments.rules may only reference lead lists owned by the same user',
  'user B cannot reference user A''s list either');
reset role;
select is((select count(*)::int from public.lead_segments where user_id = (select id from fx where name = 'user_a') and name <> 'Hijacked'), 2,
  '...and both of user A''s segments are still there, unchanged');

-- Table privileges (explicit, not environment defaults) -----------------------
select ok(not has_table_privilege('anon', 'public.lead_segments', 'select'), 'anon has no access to lead_segments at all');
select ok(has_table_privilege('authenticated', 'public.lead_segments', 'select, insert, update, delete'),
  'authenticated has the four row privileges RLS governs');
select ok(not has_table_privilege('authenticated', 'public.lead_segments', 'truncate'),
  'authenticated cannot TRUNCATE (which would bypass RLS)');
set local role anon;
select throws_ok($$select count(*) from public.lead_segments$$, '42501', null, 'anon is refused outright');
reset role;

-- Constraints ---------------------------------------------------------------
select throws_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_a'), 'Object rules', '{"field": "status"}'::jsonb)$$,
  '23514', null, 'rules must be a JSON array');
select throws_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_a'), 'No rules', '[]'::jsonb)$$,
  '23514', null, 'a segment needs at least one rule');
select throws_ok(
  $$insert into public.lead_segments (user_id, name, rules)
    values ((select id from fx where name = 'user_a'), '   ', pg_temp.status_rule())$$,
  '23514', null, 'a blank name is rejected');
select lives_ok(
  $$delete from public.lead_lists where id = (select id from fx where name = 'list_a')$$,
  'deleting a list a segment references is still allowed (the rule then matches nothing)');

select * from finish();
rollback;
