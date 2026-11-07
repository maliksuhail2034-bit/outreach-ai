-- Restores the claim-time suppression check in claimable_due_sends().
--
-- 20260730100020_claim_due_sends.sql excluded suppressed addresses when
-- claiming due sends. 20260804100000_sending_limits.sql rewrote
-- claim_due_sends() without that clause, and
-- 20260925100000_claim_due_sends_per_mailbox_capacity.sql carried the
-- omission into claimable_due_sends(). Since then the only thing stopping a
-- send to a suppressed address has been send-worker.ts's getSuppression()
-- re-check just before the send. That re-check still runs, unchanged, and
-- still covers a suppression that lands after the claim.
--
-- Effects of the restored clause:
--   - a suppressed lead is no longer claimed, so it can't take its
--     mailbox's one in-flight slot, or campaign capacity, from a lead that
--     can be sent to;
--   - dispatch (20261019100000_cron_dispatch_only_when_due.sql checks
--     exists (select 1 from claimable_due_sends())) no longer fires for a
--     tick whose only due leads are suppressed.
-- A suppressed enrollment that is never claimed keeps its status: the send
-- worker only moves it to unsubscribed/bounced when it claims it. That is
-- how claiming behaved before 20260804100000.
--
-- Everything else is copied verbatim from
-- 20260925100000_claim_due_sends_per_mailbox_capacity.sql; claim_due_sends()
-- itself is unchanged and not redefined here. Same signature, so create or
-- replace keeps the grants; they are restated anyway so this file alone
-- states who can execute the function.

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
    -- Restored from 20260730100020_claim_due_sends.sql (dropped by
    -- 20260804100000_sending_limits.sql): an address the campaign owner has
    -- suppressed is never claimed. Scoped to the owner, exactly like the send
    -- worker's pre-send getSuppression() re-check: another account's
    -- suppression of the same address does not apply.
    and not exists (
      select 1 from public.suppressions s
      join public.leads l on l.id = cl.lead_id
      where s.user_id = c.user_id and s.email = l.email
    )
$$;

comment on function public.claimable_due_sends(uuid[]) is 'Read-only eligibility set for claim_due_sends(): due campaign_leads whose mailbox has no send in flight and is under its daily/hourly/cooldown limits, whose campaign has remaining daily capacity, and whose address the campaign owner has not suppressed. Internal to the send worker — not exposed to API roles.';

revoke execute on function public.claimable_due_sends(uuid[]) from public, anon, authenticated;
grant execute on function public.claimable_due_sends(uuid[]) to service_role;
