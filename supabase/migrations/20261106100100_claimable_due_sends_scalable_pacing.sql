-- claimable_due_sends(): index-backed usage counts and human-like pacing.
--
-- 1. Cost. The previous version computed every mailbox's sent-today,
--    sent-this-hour and last-sent time, and every campaign's sent-today,
--    with system-wide GROUP BYs over email_events. The supporting partial
--    indexes are keyed (mailbox_id, created_at) / (campaign_id, created_at),
--    so a filter on created_at alone can't seek them: each CTE walked every
--    'sent' event ever recorded. The function runs up to four times a
--    minute (the dispatch check plus three calls inside claim_due_sends()),
--    so its cost grew with total send history, not with what was due.
--    Usage is now computed only for the mailboxes and campaigns that have a
--    due lead, each with a LATERAL lookup that seeks the existing index:
--    O(due mailboxes * log n) instead of O(all sends ever).
--
-- 2. Pacing. A configured cooldown was an exact interval, so a mailbox
--    with a 5-minute cooldown sent at 09:00, 09:05, 09:10... — a perfectly
--    regular cadence that mailbox providers read as automation. The gap now
--    gets a jitter of 0-50% on top of cooldown_minutes (a 5-minute cooldown
--    waits 5 to 7.5 minutes). The cooldown is still the floor, so nothing
--    sends sooner than before; hourly and daily limits are unchanged.
--    cooldown_minutes = 0 keeps meaning "no minimum gap". The jitter is
--    derived from a hash of the mailbox id and its last send time rather
--    than random(), so the three calls inside one claim_due_sends() agree
--    on which mailboxes are eligible, and it changes after every send.
--
-- Eligibility rules are otherwise identical to
-- 20261025100000_claimable_due_sends_suppression.sql (same signature and
-- result columns; claim_due_sends() is unchanged and not redefined).

create or replace function public.claimable_due_sends(p_mailbox_ids uuid[] default null)
returns table (id uuid, mailbox_id uuid, campaign_id uuid, next_send_at timestamptz, campaign_capacity bigint)
language sql
stable
as $$
  with due as (
    select cl.id, cl.mailbox_id, cl.campaign_id, cl.next_send_at, cl.lead_id, c.user_id, c.daily_limit
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    join public.mailboxes m on m.id = cl.mailbox_id
    where (p_mailbox_ids is null or cl.mailbox_id = any (p_mailbox_ids))
      and cl.status = 'active'
      and cl.next_send_at is not null and cl.next_send_at <= now()
      and (cl.locked_until is null or cl.locked_until < now())
      and c.status = 'active'
      and cl.mailbox_id is not null and m.status = 'active'
  ),
  mailbox_usage as (
    select
      m.id as mailbox_id,
      m.daily_limit,
      m.hourly_limit,
      today.c as sent_today,
      this_hour.c as sent_this_hour,
      last_sent.created_at as last_sent_at,
      m.cooldown_minutes * 60.0 as min_gap_seconds
    from public.mailboxes m
    cross join lateral (
      select count(*) as c from public.email_events e
      where e.mailbox_id = m.id and e.event_type = 'sent' and e.created_at >= date_trunc('day', now())
    ) today
    cross join lateral (
      select count(*) as c from public.email_events e
      where e.mailbox_id = m.id and e.event_type = 'sent' and e.created_at >= now() - interval '1 hour'
    ) this_hour
    left join lateral (
      select e.created_at from public.email_events e
      where e.mailbox_id = m.id and e.event_type = 'sent'
      order by e.created_at desc
      limit 1
    ) last_sent on true
    where m.id in (select d.mailbox_id from due d)
  ),
  campaign_usage as (
    select
      c.id as campaign_id,
      today.c as sent_today,
      in_flight.c as in_flight
    from public.campaigns c
    cross join lateral (
      select count(*) as c from public.email_events e
      where e.campaign_id = c.id and e.event_type = 'sent' and e.created_at >= date_trunc('day', now())
    ) today
    cross join lateral (
      select count(*) as c from public.campaign_leads f
      where f.campaign_id = c.id and f.locked_until >= now()
    ) in_flight
    where c.id in (select d.campaign_id from due d)
  )
  select
    d.id,
    d.mailbox_id,
    d.campaign_id,
    d.next_send_at,
    d.daily_limit - cu.sent_today - cu.in_flight as campaign_capacity
  from due d
  join mailbox_usage mu on mu.mailbox_id = d.mailbox_id
  join campaign_usage cu on cu.campaign_id = d.campaign_id
  where mu.sent_today < mu.daily_limit
    and mu.sent_this_hour < mu.hourly_limit
    and (
      mu.min_gap_seconds = 0
      or mu.last_sent_at is null
      or mu.last_sent_at <= now() - make_interval(
        secs => mu.min_gap_seconds
          * (1 + 0.5 * (abs(hashtext(d.mailbox_id::text || mu.last_sent_at::text)::bigint) % 1000) / 1000.0)
      )
    )
    and d.daily_limit - cu.sent_today - cu.in_flight > 0
    and not exists (
      select 1 from public.campaign_leads f
      where f.mailbox_id = d.mailbox_id and f.locked_until >= now()
    )
    and not exists (
      select 1 from public.suppressions s
      join public.leads l on l.id = d.lead_id
      where s.user_id = d.user_id and s.email = l.email
    )
$$;

comment on function public.claimable_due_sends(uuid[]) is 'Read-only eligibility set for claim_due_sends(): due campaign_leads whose mailbox has no send in flight, is under its daily/hourly limits and past its jittered cooldown since the last send, whose campaign has remaining daily capacity, and whose address the campaign owner has not suppressed. Internal to the send worker — not exposed to API roles.';

revoke execute on function public.claimable_due_sends(uuid[]) from public, anon, authenticated;
grant execute on function public.claimable_due_sends(uuid[]) to service_role;

-- Lets the in-flight lookups (per mailbox, per campaign) seek instead of
-- scanning: only rows currently holding a lease are indexed.
create index if not exists campaign_leads_locked_mailbox_idx
  on public.campaign_leads (mailbox_id, locked_until)
  where locked_until is not null;
create index if not exists campaign_leads_locked_campaign_idx
  on public.campaign_leads (campaign_id, locked_until)
  where locked_until is not null;
