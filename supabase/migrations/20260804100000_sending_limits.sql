-- Phase 2D: Campaign Sending Engine — sending-limits foundation. Layers
-- hourly caps and an inter-send cooldown per mailbox on top of the daily
-- limit already enforced in claim_due_sends() (see
-- 20260730100020_claim_due_sends.sql), and allows campaign_leads.status =
-- 'cancelled'. This extends the existing claim function and status
-- constraint in place rather than introducing a second queue/claim path —
-- daily/hourly/cooldown are all just additional eligibility checks in the
-- same atomic claim.
--
-- 'cancelled' is a lead whose remaining sequence was deliberately stopped
-- (distinct from 'completed', which means the sequence ran to its end, and
-- 'failed', which means the worker gave up after repeated errors).
-- claim_due_sends() already only ever selects status = 'active', so
-- cancelling a lead needs no separate exclusion logic — setting the status
-- is enough, the exact same mechanism every other terminal state already
-- uses.
--
-- No new sequence_id column on campaign_leads: sequences aren't a
-- user-facing concept yet (every campaign has at most one — see
-- getOrCreateDefaultSequence in lib/db/sequences.ts), so it's fully
-- derivable from current_step_id -> sequence_steps.sequence_id whenever
-- it's actually needed. A column duplicating that would be a second source
-- of truth for no behavior gained.

alter table public.mailboxes
  add column hourly_limit integer not null default 10
    constraint mailboxes_hourly_limit_check check (hourly_limit > 0),
  add column cooldown_minutes integer not null default 0
    constraint mailboxes_cooldown_minutes_check check (cooldown_minutes >= 0);

comment on column public.mailboxes.hourly_limit is 'Max sends from this mailbox per rolling hour, enforced in claim_due_sends().';
comment on column public.mailboxes.cooldown_minutes is 'Minimum minutes required between two sends from this mailbox. 0 disables the cooldown.';

alter table public.campaign_leads drop constraint campaign_leads_status_check;
alter table public.campaign_leads add constraint campaign_leads_status_check
  check (status in ('pending', 'active', 'replied', 'bounced', 'unsubscribed', 'completed', 'failed', 'needs_review', 'cancelled'));

-- Replaces the function from 20260730100020_claim_due_sends.sql: same
-- signature, locking strategy, and daily-limit checks, plus hourly-limit
-- and cooldown checks. Reuses the existing partial indexes
-- (email_events_mailbox_sent_today_idx / _campaign_sent_today_idx) for the
-- new time-windowed aggregates too — both are already keyed on
-- (mailbox_id/campaign_id, created_at) with event_type = 'sent', which
-- covers a one-hour window and a "most recent send" lookup just as well as
-- the existing "since start of day" one, so no new index is needed.
create or replace function public.claim_due_sends(p_limit integer default 25)
returns setof public.campaign_leads
language plpgsql
as $$
begin
  return query
  with sent_today as (
    select mailbox_id, count(*) as c
    from public.email_events
    where event_type = 'sent' and created_at >= date_trunc('day', now())
    group by mailbox_id
  ),
  campaign_sent_today as (
    select campaign_id, count(*) as c
    from public.email_events
    where event_type = 'sent' and created_at >= date_trunc('day', now())
    group by campaign_id
  ),
  sent_this_hour as (
    select mailbox_id, count(*) as c
    from public.email_events
    where event_type = 'sent' and created_at >= now() - interval '1 hour'
    group by mailbox_id
  ),
  last_sent as (
    select mailbox_id, max(created_at) as last_sent_at
    from public.email_events
    where event_type = 'sent'
    group by mailbox_id
  ),
  candidates as (
    select cl.id
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    left join public.mailboxes m on m.id = cl.mailbox_id
    left join sent_today st on st.mailbox_id = cl.mailbox_id
    left join campaign_sent_today cst on cst.campaign_id = cl.campaign_id
    left join sent_this_hour sth on sth.mailbox_id = cl.mailbox_id
    left join last_sent ls on ls.mailbox_id = cl.mailbox_id
    where cl.status = 'active'
      and cl.next_send_at is not null and cl.next_send_at <= now()
      and (cl.locked_until is null or cl.locked_until < now())
      and c.status = 'active'
      and cl.mailbox_id is not null and m.status = 'active'
      and coalesce(st.c, 0) < m.daily_limit
      and coalesce(cst.c, 0) < c.daily_limit
      and coalesce(sth.c, 0) < m.hourly_limit
      and (
        m.cooldown_minutes = 0
        or ls.last_sent_at is null
        or ls.last_sent_at <= now() - make_interval(mins => m.cooldown_minutes)
      )
    order by cl.next_send_at
    limit p_limit
    for update of cl skip locked
  )
  update public.campaign_leads
  set locked_until = now() + interval '10 minutes'
  where id in (select id from candidates)
  returning *;
end;
$$;
