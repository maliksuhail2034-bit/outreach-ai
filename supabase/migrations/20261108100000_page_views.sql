-- First-party, cookieless traffic analytics for the staff console
-- (/console/traffic). One row per full page load (a document request seen by
-- proxy.ts); in-app navigation between pages after the first load is not a
-- separate row.
--
-- Privacy by construction: no IP address, no user agent string, no user id
-- and no query string is stored. visitor_hash is a keyed hash of
-- (IP, user agent) with a salt that changes every UTC day, so it counts
-- unique visitors within a day and can't follow anyone across days. Paths
-- are normalised before storage (ids and tokens replaced by ":id").
-- Rows are deleted after 180 days by the retention worker.

create table public.page_views (
  id uuid primary key default gen_random_uuid(),
  day date not null default ((now() at time zone 'utc')::date),
  path text not null
    constraint page_views_path_length check (char_length(path) between 1 and 300),
  referrer_host text
    constraint page_views_referrer_host_length check (referrer_host is null or char_length(referrer_host) <= 253),
  utm_source text
    constraint page_views_utm_source_length check (utm_source is null or char_length(utm_source) <= 100),
  country text
    constraint page_views_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  device text not null
    constraint page_views_device_check check (device in ('desktop', 'mobile', 'tablet')),
  visitor_hash text not null
    constraint page_views_visitor_hash_format check (visitor_hash ~ '^[0-9a-f]{32}$'),
  signed_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.page_views is 'Cookieless page-load analytics written by proxy.ts (service role). No IP, user agent, user id or query string; visitor_hash rotates daily. Pruned after 180 days.';

create index page_views_day_idx on public.page_views (day);
create index page_views_created_at_idx on public.page_views (created_at);

alter table public.page_views enable row level security;

create trigger page_views_set_updated_at
  before update on public.page_views
  for each row execute function public.set_updated_at();

-- Explicit privileges (see 20261107100000_staff_console.sql for why): no API
-- policy and no customer access at all; the service role inserts (proxy),
-- reads (console) and deletes (retention).
revoke all on table public.page_views from anon, authenticated, service_role;
grant select, insert, delete on table public.page_views to service_role;

-- Every aggregate the Traffic page shows, computed in one call so no table
-- read is capped by PostgREST's max_rows. "visitors" counts distinct
-- (day, visitor_hash) pairs: unique visitors per day, summed over the range.
create function public.traffic_summary(p_from date, p_to date, p_limit integer default 10)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with v as (
    select * from public.page_views
    where day between p_from and p_to
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  )
  select jsonb_build_object(
    'page_views', (select count(*) from v),
    'visitors', (select count(distinct (day, visitor_hash)) from v),
    'signed_in_views', (select count(*) from v where signed_in),
    'countries_count', (select count(distinct country) from v where country is not null),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'views', coalesce(x.views, 0),
        'visitors', coalesce(x.visitors, 0)
      ) order by days.day), '[]'::jsonb)
      from days
      left join (
        select day, count(*) as views, count(distinct visitor_hash) as visitors from v group by day
      ) x on x.day = days.day
    ),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object('key', key, 'views', views, 'visitors', visitors) order by visitors desc, views desc), '[]'::jsonb)
      from (
        select coalesce(country, '??') as key, count(*) as views, count(distinct (day, visitor_hash)) as visitors
        from v group by 1 order by 3 desc, 2 desc limit p_limit
      ) t
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('key', key, 'views', views, 'visitors', visitors) order by views desc), '[]'::jsonb)
      from (
        select path as key, count(*) as views, count(distinct (day, visitor_hash)) as visitors
        from v group by 1 order by 2 desc limit p_limit
      ) t
    ),
    'referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('key', key, 'views', views, 'visitors', visitors) order by visitors desc), '[]'::jsonb)
      from (
        select coalesce(utm_source, referrer_host, '(direct)') as key, count(*) as views, count(distinct (day, visitor_hash)) as visitors
        from v group by 1 order by 3 desc, 2 desc limit p_limit
      ) t
    ),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object('key', device, 'views', views, 'visitors', visitors) order by visitors desc), '[]'::jsonb)
      from (
        select device, count(*) as views, count(distinct (day, visitor_hash)) as visitors from v group by 1
      ) t
    )
  );
$$;

revoke execute on function public.traffic_summary(date, date, integer) from public, anon, authenticated;
grant execute on function public.traffic_summary(date, date, integer) to service_role;
