-- Security alerts and the "Sign-ins & locations" tab, aggregated in SQL.
-- They used to read the latest 5,000 / 10,000 auth_events rows into the
-- app, so a large password-guessing burst could push older events out of
-- the counts. auth_event_summary() aggregates the whole window instead and
-- returns only the small result the console shows. Service role only.

create function public.auth_event_summary(p_since timestamptz, p_list_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select event_type, ip, email_hash, user_id, country
    from public.auth_events
    where created_at >= p_since
  )
  select jsonb_build_object(
    'successes', (select count(*) from e where event_type = 'sign_in_success'),
    'failures', (select count(*) from e where event_type = 'sign_in_failure'),
    'rate_limited', (select count(*) from e where event_type = 'sign_in_rate_limited'),
    -- Addresses with the most refused attempts (failed or rate limited).
    'by_ip', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.refused desc, t.failures desc), '[]'::jsonb)
      from (
        select ip,
          count(*) filter (where event_type = 'sign_in_failure') as failures,
          count(*) as refused,
          mode() within group (order by country) as country
        from e
        where event_type <> 'sign_in_success' and ip is not null
        group by ip
        order by refused desc, failures desc
        limit p_list_limit
      ) t
    ),
    -- Accounts (as the hash of what was typed) with the most failures.
    'by_account', (
      select coalesce(jsonb_agg(t.failures order by t.failures desc), '[]'::jsonb)
      from (
        select count(*) as failures
        from e
        where event_type = 'sign_in_failure' and email_hash is not null
        group by email_hash
        order by failures desc
        limit p_list_limit
      ) t
    ),
    -- Staff accounts that signed in successfully from 2+ countries.
    'staff_multi_country', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'countries', t.countries)), '[]'::jsonb)
      from (
        select e.user_id, array_agg(distinct e.country order by e.country) as countries
        from e
        join public.staff_members s on s.user_id = e.user_id
        where e.event_type = 'sign_in_success' and e.country is not null
        group by e.user_id
        having count(distinct e.country) >= 2
      ) t
    ),
    'countries', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.successes + t.refused desc), '[]'::jsonb)
      from (
        select coalesce(country, 'Unknown') as country,
          count(*) filter (where event_type = 'sign_in_success') as successes,
          count(*) filter (where event_type <> 'sign_in_success') as refused
        from e
        group by 1
      ) t
    )
  );
$$;

revoke all on function public.auth_event_summary(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.auth_event_summary(timestamptz, integer) to service_role;
