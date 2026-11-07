-- Range-scoped aggregates for the /analytics page.
--
-- The page used to build its numbers in Node from capped row fetches: the
-- latest 500 send_attempts for the charts, and, per campaign, every
-- campaign_leads id passed back to PostgREST in a single `in (...)` filter.
-- That broke in two ways once real data arrived: the charts silently showed
-- only the most recent 500 attempts, and a campaign with a few hundred
-- enrolled leads produced a request URL too long for the API gateway, which
-- failed the whole page. Its date-range picker also only drove a section
-- reading analytics_events, a table nothing writes to, so it never changed
-- anything visible.
--
-- These two functions do the grouping in Postgres and return a few dozen
-- rows regardless of data volume. Both are SECURITY INVOKER: they run as the
-- calling user, so email_events/send_attempts RLS still applies, and the
-- explicit `c.user_id = auth.uid()` join lets the planner start from the
-- caller's own campaigns and use the existing (campaign_id, created_at)
-- index instead of scanning every event in range.

create or replace function public.analytics_daily_event_counts(
  p_since timestamptz,
  p_until timestamptz,
  p_timezone text default 'UTC'
)
returns table (day date, event_type text, event_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (e.created_at at time zone p_timezone)::date as day,
    e.event_type,
    count(*) as event_count
  from public.email_events e
  join public.campaigns c on c.id = e.campaign_id and c.user_id = auth.uid()
  where e.created_at >= p_since
    and e.created_at < p_until
  group by 1, 2

  union all

  -- Terminal send failures live in send_attempts, not email_events.
  select
    (coalesce(sa.resolved_at, sa.claimed_at) at time zone p_timezone)::date,
    'failed'::text,
    count(*)
  from public.send_attempts sa
  join public.campaign_leads cl on cl.id = sa.campaign_lead_id
  join public.campaigns c on c.id = cl.campaign_id and c.user_id = auth.uid()
  where sa.status = 'failed'
    and coalesce(sa.resolved_at, sa.claimed_at) >= p_since
    and coalesce(sa.resolved_at, sa.claimed_at) < p_until
  group by 1
$$;

comment on function public.analytics_daily_event_counts(timestamptz, timestamptz, text) is
  'Per-day email event counts (plus failed send attempts as event_type ''failed'') for the caller''s campaigns in [p_since, p_until), bucketed in p_timezone. SECURITY INVOKER — RLS applies.';

create or replace function public.analytics_campaign_event_counts(p_since timestamptz, p_until timestamptz)
returns table (campaign_id uuid, event_type text, event_count bigint, unique_leads bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.campaign_id, e.event_type, count(*) as event_count, count(distinct e.lead_id) as unique_leads
  from public.email_events e
  join public.campaigns c on c.id = e.campaign_id and c.user_id = auth.uid()
  where e.created_at >= p_since
    and e.created_at < p_until
  group by e.campaign_id, e.event_type

  union all

  select cl.campaign_id, 'failed'::text, count(*), count(distinct cl.lead_id)
  from public.send_attempts sa
  join public.campaign_leads cl on cl.id = sa.campaign_lead_id
  join public.campaigns c on c.id = cl.campaign_id and c.user_id = auth.uid()
  where sa.status = 'failed'
    and coalesce(sa.resolved_at, sa.claimed_at) >= p_since
    and coalesce(sa.resolved_at, sa.claimed_at) < p_until
  group by cl.campaign_id
$$;

comment on function public.analytics_campaign_event_counts(timestamptz, timestamptz) is
  'Per-campaign email event totals and distinct-lead counts (plus failed send attempts as event_type ''failed'') for the caller''s campaigns in [p_since, p_until). SECURITY INVOKER — RLS applies.';

revoke execute on function public.analytics_daily_event_counts(timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.analytics_campaign_event_counts(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_daily_event_counts(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.analytics_campaign_event_counts(timestamptz, timestamptz) to authenticated;

-- Supports the send_attempts half of both functions: failed attempts for a
-- campaign_lead within a time range.
create index if not exists send_attempts_failed_campaign_lead_idx
  on public.send_attempts (campaign_lead_id, resolved_at)
  where status = 'failed';
