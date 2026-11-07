-- Tests for archiving leavers (supabase/migrations/20261111100000_staff_archive.sql).
-- Run against the LOCAL stack only: `supabase test db`. One transaction, rolled back.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

do $$
declare v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'leaver@staff-archive-test.invalid');
  insert into public.staff_members (user_id, role, display_name, username) values (v_user, 'sales', 'Lea Ver', 'lea.ver');
end $$;

select lives_ok(
  $$update public.staff_members set status = 'archived', archived_at = now() where username = 'lea.ver'$$,
  'an account can be archived with its archive time');
select throws_ok(
  $$update public.staff_members set archived_at = null where username = 'lea.ver'$$,
  '23514', null, 'an archived account always has an archive time');
select throws_ok(
  $$update public.staff_members set status = 'active' where username = 'lea.ver'$$,
  '23514', null, 'an archive time can only belong to an archived account');
select throws_ok(
  $$update public.staff_members set status = 'gone' where username = 'lea.ver'$$,
  '23514', null, 'status is a fixed list');

select * from finish();
rollback;
