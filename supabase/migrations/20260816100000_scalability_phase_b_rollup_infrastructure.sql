-- Scalability Track, Phase B (Infrastructure): the single migration this
-- phase needs -- two additive prerequisites for the two new cron workers
-- built in this phase (the analytics rollup worker and the retention
-- worker). Neither change touches any existing row, table shape, or read
-- path. No worker created here is wired into any production analytics
-- page yet -- that is Phase D.

-- 1. job_runs.job's allow-list only names the 5 pre-existing cron routes
-- (20260811100000_job_runs.sql). Without widening it, every invocation of
-- the two new cron routes this phase adds would fail to persist its
-- job_runs row (caught by run-cron-job.ts's best-effort .catch(), so the
-- route itself would not crash -- but the new workers' observability
-- history, the same thing this whole track has used to verify every other
-- cron job's health, would silently never work from their first run).
alter table public.job_runs
  drop constraint job_runs_job_check;

alter table public.job_runs
  add constraint job_runs_job_check
  check (job in (
    'send-emails', 'sync-replies', 'verify-leads', 'deliverability-health-check',
    'integrations-digest', 'analytics-rollup', 'retention-cleanup'
  ));

-- 2. Grouped daily counts of email_events, computed in SQL rather than
-- fetched-and-grouped in application code (the exact pattern this track's
-- audit flagged as the root cause of the organization-wide analytics
-- page's N+1 cost -- see lib/analytics/organization-rollup.ts). Covers the
-- three subject types directly derivable from one email_events row:
-- campaign, mailbox (only when set -- mailbox_id is nullable), and
-- organization (every event, regardless of campaign/mailbox). Domain-level
-- rollups are not computed here -- lib/deliverability/domain-analytics.ts
-- already derives a domain's numbers by summing its constituent mailboxes'
-- events, so the future rollup worker does the same by summing this
-- function's mailbox-level rows over each domain's mailboxes, reusing that
-- existing pattern rather than adding a fourth SQL branch here.
--
-- email_events has no organization_id column -- it is derived via
-- campaigns.user_id -> organization_members.user_id, the same join path
-- lib/db/organizations.ts's getUserOrganization() relies on everywhere
-- else in this codebase. That code (and this function) assumes one user
-- belongs to exactly one organization, which is the standing assumption
-- the organizations migration itself documents ("one user = exactly one
-- organization... no invites/seats yet"). An inner join means a user_id
-- with no organization_members row (should not happen post-backfill, see
-- that migration) is silently excluded from rollups rather than
-- miscounted or erroring.
--
-- Called only via the service-role client (bypasses RLS at the connection
-- level), so this is a plain invoker function, not security definer --
-- same convention as claim_due_sends()/claim_due_verifications()/
-- claim_mailboxes_for_reply_sync().
create or replace function public.compute_email_event_rollups(p_since date, p_until date)
returns table (
  organization_id uuid,
  rollup_date date,
  event_type text,
  subject_type text,
  subject_id uuid,
  event_count integer
)
language sql
stable
as $$
  with scoped_events as (
    select
      ee.campaign_id,
      ee.mailbox_id,
      ee.event_type,
      date(ee.created_at) as rollup_date,
      om.organization_id
    from public.email_events ee
    join public.campaigns c on c.id = ee.campaign_id
    join public.organization_members om on om.user_id = c.user_id
    where date(ee.created_at) between p_since and p_until
  )
  select organization_id, rollup_date, event_type, 'campaign'::text as subject_type,
         campaign_id as subject_id, count(*)::integer as event_count
  from scoped_events
  group by organization_id, rollup_date, event_type, campaign_id

  union all

  select organization_id, rollup_date, event_type, 'mailbox'::text,
         mailbox_id, count(*)::integer
  from scoped_events
  where mailbox_id is not null
  group by organization_id, rollup_date, event_type, mailbox_id

  union all

  select organization_id, rollup_date, event_type, 'organization'::text,
         organization_id, count(*)::integer
  from scoped_events
  group by organization_id, rollup_date, event_type;
$$;
