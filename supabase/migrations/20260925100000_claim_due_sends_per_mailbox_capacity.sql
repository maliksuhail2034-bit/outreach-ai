-- Fixes claim_due_sends() overshooting mailbox hourly/daily/cooldown limits
-- and campaign daily limits (see 20260804100000_sending_limits.sql for the
-- version this replaces). That version checked every limit per row against
-- one snapshot count taken from email_events, which never included (a) other
-- leads selected in the same claim batch or (b) leads already claimed by an
-- overlapping worker invocation but not yet sent. A mailbox with
-- hourly_limit 10 and 25 due leads therefore had all 25 claimed in one call
-- and sent back to back. Reproduced read-only against production data during
-- the scheduler feasibility audit.
--
-- The fix makes the snapshot counts exact instead of adding more counting:
--   - at most ONE lead per mailbox per claim, and
--   - never a lead for a mailbox that already has a lead in flight
--     (locked_until >= now()).
-- A mailbox therefore has at most one send in flight at any time, and
-- record_send_success() inserts its 'sent' email_events row and clears
-- locked_until in the same transaction — so "sent < limit" at claim time
-- always means "sent + 1 <= limit" after the send. Campaign daily limits,
-- which span several mailboxes, are enforced across the batch with a
-- per-campaign rank against remaining capacity (daily_limit - sent today -
-- in flight).
--
-- Concurrency: both invariants above are checked against a snapshot, so two
-- claims running at the same moment could each still pass them. Instead of
-- a global advisory lock (which would serialize every claim for every org),
-- the claim locks only the rows it is about to act on, with SKIP LOCKED so a
-- concurrent claim never waits — it just skips that mailbox/campaign for
-- this tick:
--   1. candidate mailboxes      FOR NO KEY UPDATE SKIP LOCKED
--   2. their leads' campaigns   FOR NO KEY UPDATE SKIP LOCKED
--   3. re-evaluate eligibility in a NEW statement (fresh READ COMMITTED
--      snapshot, taken after the locks are held, so any claim that held them
--      first and committed is now visible as in flight), then lock the lead
--      rows FOR UPDATE SKIP LOCKED and set the lease — unchanged.
-- NO KEY UPDATE (not UPDATE) so these locks don't conflict with the FOR KEY
-- SHARE locks taken by foreign-key checks — e.g. record_send_success()'s
-- email_events insert referencing the same mailbox/campaign never blocks on
-- a claim. Lock order is irrelevant for deadlocks here: every lock this
-- function takes is SKIP LOCKED, so it never waits on anything.
--
-- Unchanged: the function signature, every eligibility predicate, ordering
-- by next_send_at, the 10-minute locked_until lease, and send_attempts
-- (claim_send_attempt() is still what stops a duplicate send).

-- Every eligibility predicate lives here once, so all three phases of
-- claim_due_sends() below evaluate exactly the same rules. Read-only: it
-- claims nothing and locks nothing. p_mailbox_ids = null means every
-- mailbox.
create or replace function public.claimable_due_sends(p_mailbox_ids uuid[] default null)
returns table (id uuid, mailbox_id uuid, campaign_id uuid, next_send_at timestamptz, campaign_capacity bigint)
language sql
stable
as $$
  with sent_today as (
    select e.mailbox_id, count(*) as c
    from public.email_events e
    where e.event_type = 'sent' and e.created_at >= date_trunc('day', now())
    group by e.mailbox_id
  ),
  campaign_sent_today as (
    select e.campaign_id, count(*) as c
    from public.email_events e
    where e.event_type = 'sent' and e.created_at >= date_trunc('day', now())
    group by e.campaign_id
  ),
  sent_this_hour as (
    select e.mailbox_id, count(*) as c
    from public.email_events e
    where e.event_type = 'sent' and e.created_at >= now() - interval '1 hour'
    group by e.mailbox_id
  ),
  last_sent as (
    select e.mailbox_id, max(e.created_at) as last_sent_at
    from public.email_events e
    where e.event_type = 'sent'
    group by e.mailbox_id
  ),
  campaign_in_flight as (
    select f.campaign_id, count(*) as c
    from public.campaign_leads f
    where f.locked_until >= now()
    group by f.campaign_id
  )
  select
    cl.id,
    cl.mailbox_id,
    cl.campaign_id,
    cl.next_send_at,
    c.daily_limit - coalesce(cst.c, 0) - coalesce(cif.c, 0) as campaign_capacity
  from public.campaign_leads cl
  join public.campaigns c on c.id = cl.campaign_id
  join public.mailboxes m on m.id = cl.mailbox_id
  left join sent_today st on st.mailbox_id = cl.mailbox_id
  left join campaign_sent_today cst on cst.campaign_id = cl.campaign_id
  left join sent_this_hour sth on sth.mailbox_id = cl.mailbox_id
  left join last_sent ls on ls.mailbox_id = cl.mailbox_id
  left join campaign_in_flight cif on cif.campaign_id = cl.campaign_id
  where (p_mailbox_ids is null or cl.mailbox_id = any (p_mailbox_ids))
    and cl.status = 'active'
    and cl.next_send_at is not null and cl.next_send_at <= now()
    and (cl.locked_until is null or cl.locked_until < now())
    and c.status = 'active'
    and cl.mailbox_id is not null and m.status = 'active'
    and coalesce(st.c, 0) < m.daily_limit
    and coalesce(sth.c, 0) < m.hourly_limit
    and (
      m.cooldown_minutes = 0
      or ls.last_sent_at is null
      or ls.last_sent_at <= now() - make_interval(mins => m.cooldown_minutes)
    )
    and c.daily_limit - coalesce(cst.c, 0) - coalesce(cif.c, 0) > 0
    and not exists (
      select 1 from public.campaign_leads f
      where f.mailbox_id = cl.mailbox_id and f.locked_until >= now()
    )
$$;

comment on function public.claimable_due_sends(uuid[]) is 'Read-only eligibility set for claim_due_sends(): due campaign_leads whose mailbox has no send in flight and is under its daily/hourly/cooldown limits, and whose campaign has remaining daily capacity. Internal to the send worker — not exposed to API roles.';

-- Internal helper for claim_due_sends() only (called by the worker via the
-- service-role client). Supabase's default privileges would otherwise make
-- it callable by anon/authenticated through PostgREST. service_role is
-- granted explicitly because revoking PUBLIC also removes the grant it would
-- otherwise inherit — without it, claim_due_sends() (security invoker,
-- called as service_role) fails with a permission error.
revoke execute on function public.claimable_due_sends(uuid[]) from public, anon, authenticated;
grant execute on function public.claimable_due_sends(uuid[]) to service_role;

create or replace function public.claim_due_sends(p_limit integer default 25)
returns setof public.campaign_leads
language plpgsql
as $$
declare
  v_mailbox_ids uuid[];
  v_campaign_ids uuid[];
begin
  -- 1. Lock up to p_limit mailboxes that currently have a claimable lead,
  -- earliest-due first. A mailbox held by a concurrent claim is skipped.
  select coalesce(array_agg(locked.id), '{}') into v_mailbox_ids
  from (
    select m.id
    from public.mailboxes m
    join (
      select e.mailbox_id, min(e.next_send_at) as earliest
      from public.claimable_due_sends() e
      group by e.mailbox_id
    ) due on due.mailbox_id = m.id
    order by due.earliest, m.id
    limit p_limit
    for no key update of m skip locked
  ) locked;

  if cardinality(v_mailbox_ids) = 0 then
    return;
  end if;

  -- 2. Lock the campaigns those mailboxes' claimable leads belong to, so two
  -- claims on different mailboxes can't both spend one campaign's last
  -- daily capacity. A campaign held by a concurrent claim is skipped.
  select coalesce(array_agg(locked.id), '{}') into v_campaign_ids
  from (
    select c.id
    from public.campaigns c
    where c.id in (select e.campaign_id from public.claimable_due_sends(v_mailbox_ids) e)
    order by c.id
    for no key update of c skip locked
  ) locked;

  if cardinality(v_campaign_ids) = 0 then
    return;
  end if;

  -- 3. New statement = fresh snapshot, taken with the locks above held.
  -- One lead per mailbox (earliest due), then admit per campaign only while
  -- within its remaining daily capacity. A mailbox whose earliest lead's
  -- campaign has no room this tick claims nothing this tick (a safe
  -- under-claim; it's picked up on a later tick).
  return query
  with one_per_mailbox as (
    select distinct on (e.mailbox_id) e.id, e.campaign_id, e.next_send_at, e.campaign_capacity
    from public.claimable_due_sends(v_mailbox_ids) e
    where e.campaign_id = any (v_campaign_ids)
    order by e.mailbox_id, e.next_send_at, e.id
  ),
  within_campaign_capacity as (
    select r.id
    from (
      select o.id, o.campaign_capacity,
        row_number() over (partition by o.campaign_id order by o.next_send_at, o.id) as campaign_rank
      from one_per_mailbox o
    ) r
    where r.campaign_rank <= r.campaign_capacity
  ),
  candidates as (
    select cl.id
    from public.campaign_leads cl
    where cl.id in (select w.id from within_campaign_capacity w)
      and cl.status = 'active'
      and cl.next_send_at is not null
      and cl.next_send_at <= now()
      and (cl.locked_until is null or cl.locked_until < now())
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

comment on function public.claim_due_sends(integer) is 'Atomically claims due campaign_leads for the send worker: at most one lead per mailbox, never for a mailbox with a send already in flight, within mailbox daily/hourly/cooldown and campaign daily limits. Locks only the mailboxes/campaigns/leads it acts on, all SKIP LOCKED.';
