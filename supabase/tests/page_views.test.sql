-- Tests for cookieless traffic analytics
-- (supabase/migrations/20261108100000_page_views.sql).
-- Run against the LOCAL stack only: `supabase test db`. One transaction,
-- rolled back; fixtures use far-future days so real rows never interfere.

set client_min_messages = warning;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

-- Structure and privileges -------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'public.page_views'::regclass), true, 'RLS is enabled');
select is_empty($$select 1 from pg_policies where schemaname = 'public' and tablename = 'page_views'$$, 'no API policies');
select ok(
  not has_table_privilege('anon', 'public.page_views', 'select')
  and not has_table_privilege('authenticated', 'public.page_views', 'select')
  and not has_table_privilege('authenticated', 'public.page_views', 'insert')
  and not has_table_privilege('authenticated', 'public.page_views', 'truncate'),
  'customers and anonymous visitors have no access at all');
select ok(
  has_table_privilege('service_role', 'public.page_views', 'select, insert, delete')
  and not has_table_privilege('service_role', 'public.page_views', 'update'),
  'the service role can record, read and prune, never rewrite');
select ok(
  not has_function_privilege('authenticated', 'public.traffic_summary(date, date, integer)', 'execute')
  and has_function_privilege('service_role', 'public.traffic_summary(date, date, integer)', 'execute'),
  'only the service role can read the summary');
select hasnt_column('public', 'page_views', 'ip', 'no IP address column');
select hasnt_column('public', 'page_views', 'user_agent', 'no user agent column');

select throws_ok(
  $$insert into public.page_views (path, device, visitor_hash, country) values ('/', 'desktop', repeat('a', 32), 'india')$$,
  '23514', null, 'country must be a two-letter code');
select throws_ok(
  $$insert into public.page_views (path, device, visitor_hash) values ('/', 'desktop', 'not-a-hash')$$,
  '23514', null, 'visitor_hash must be a 32-character hex digest');

-- Aggregates ----------------------------------------------------------------------
-- Day 1: visitor A loads 2 pages, B loads 1 (signed in). Day 2: A again
-- (new day, so counted again), C from an unknown country via LinkedIn.
insert into public.page_views (day, path, referrer_host, utm_source, country, device, visitor_hash, signed_in) values
  ('2099-01-01', '/', 'google.com', null, 'IN', 'desktop', repeat('a', 32), false),
  ('2099-01-01', '/pricing', null, null, 'IN', 'desktop', repeat('a', 32), false),
  ('2099-01-01', '/', null, 'newsletter', 'US', 'mobile', repeat('b', 32), true),
  ('2099-01-02', '/', 'google.com', null, 'IN', 'desktop', repeat('a', 32), false),
  ('2099-01-02', '/signup', 'linkedin.com', null, null, 'tablet', repeat('c', 32), false);

create temp table s as select public.traffic_summary('2099-01-01', '2099-01-03', 10) as j;

select is((select (j->>'page_views')::int from s), 5, 'counts every page load');
select is((select (j->>'visitors')::int from s), 4, 'visitors are unique per day, summed over the range');
select is((select (j->>'signed_in_views')::int from s), 1, 'counts signed-in page loads');
select is((select jsonb_array_length(j->'daily') from s), 3, 'one daily point per day, including empty days');
select is(
  (select j->'countries'->0 from s),
  '{"key": "IN", "views": 3, "visitors": 2}'::jsonb,
  'top country by visitors');
select ok(
  (select j->'referrers' @> '[{"key": "google.com", "visitors": 2}, {"key": "newsletter", "visitors": 1}, {"key": "(direct)", "visitors": 1}]'::jsonb from s),
  'sources prefer utm_source, then referrer, then direct');
select ok((select j->'countries' @> '[{"key": "??"}]'::jsonb from s), 'visits with no located country are grouped as unknown');

select * from finish();
rollback;
