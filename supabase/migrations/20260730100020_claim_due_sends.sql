-- Indexes backing the "how many sent today" aggregates in claim_due_sends(),
-- and the atomic claim function itself. This is the correctness-critical
-- piece of the send pipeline: without row-level locking here, an overlapping
-- worker invocation (a slow previous run still executing when the next
-- cron tick fires) could claim and double-send the same lead.
--
-- Scope: this function claims at the campaign_leads (lead) level only. It
-- guarantees no two workers process the same lead concurrently and enforces
-- daily send caps + suppression at claim time. It does NOT provide send-level
-- idempotency (preventing a duplicate SMTP dispatch after a crash) — that is
-- the responsibility of send_attempts / claim_send_attempt (see the
-- send_attempts migration), layered on top of this one in the worker.

create index email_events_mailbox_sent_today_idx on public.email_events (mailbox_id, created_at)
  where event_type = 'sent';

create index email_events_campaign_sent_today_idx on public.email_events (campaign_id, created_at)
  where event_type = 'sent';

-- Called only via lib/supabase/admin.ts (service role, bypasses RLS) from
-- the sending worker — same carve-out already used by recordEmailEvent()
-- and getMailboxCredentials(): privileged, no user in the loop.
--
-- Daily limits (mailboxes.daily_limit, campaigns.daily_limit) are derived
-- from today's 'sent' email_events rather than a running counter table:
-- at the volumes cold-email daily limits operate at, a count() backed by
-- the partial indexes above is cheap, and a counter table would add write
-- amplification plus a drift-recovery problem (a crash between send and
-- decrement leaves it permanently wrong) for no benefit at this scale.
-- The day boundary is UTC — daily_limit is a deliverability/reputation
-- guard, not a compliance requirement, so per-campaign timezone precision
-- isn't worth the added complexity.
--
-- Sending-window (days/hours/timezone) is intentionally NOT re-checked
-- here: it's baked into next_send_at whenever that's computed (see
-- lib/email/scheduling.ts), so this query only needs next_send_at <= now().
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
  candidates as (
    select cl.id
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    left join public.mailboxes m on m.id = cl.mailbox_id
    left join sent_today st on st.mailbox_id = cl.mailbox_id
    left join campaign_sent_today cst on cst.campaign_id = cl.campaign_id
    where cl.status = 'active'
      and cl.next_send_at is not null and cl.next_send_at <= now()
      and (cl.locked_until is null or cl.locked_until < now())
      and c.status = 'active'
      and cl.mailbox_id is not null and m.status = 'active'
      and coalesce(st.c, 0) < m.daily_limit
      and coalesce(cst.c, 0) < c.daily_limit
      and not exists (
        select 1 from public.suppressions s
        join public.leads l on l.id = cl.lead_id
        where s.user_id = c.user_id and s.email = l.email
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
