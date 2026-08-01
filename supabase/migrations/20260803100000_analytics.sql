-- Analytics Foundation: a generic, organization-scoped event model plus
-- the derived tables (rollups/snapshots/jobs) every future dashboard, AI
-- feature, and reporting module will read from. Purely additive — no
-- existing table's ownership, RLS, or column semantics changes.
--
-- This is deliberately NOT a replacement for email_events
-- (20260728100110_email_events.sql), which stays exactly as-is and keeps
-- powering the existing /analytics page (send_attempts/email_events
-- driven). email_events is narrowly about one email's lifecycle
-- (campaign_id + lead_id required); analytics_events is intentionally
-- broader — events can be about a campaign, lead, mailbox, domain, warmup
-- profile, or the organization as a whole (subject_type/subject_id, not a
-- foreign key, so a new subject kind never needs a schema migration here)
-- and includes event types no existing table models yet (positive_reply,
-- meeting_booked, campaign_completed). A future integration can have the
-- sending worker/reply worker write to both tables, but that wiring is out
-- of this phase's scope ("build the infrastructure," not every producer).
--
-- Organization-scoped throughout (organization_id + is_organization_member()
-- RLS), matching the pattern warmup_profiles established
-- (20260802100000_warmup.sql) as the first user-writable org-scoped table.

-- Append-only event log. Only table here a regular org member can write to
-- — analytics_daily_rollups/analytics_snapshots/analytics_jobs are all
-- derived data, written only by a future aggregation worker running as the
-- service role (see lib/db/analytics.ts).
create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_type text not null
    constraint analytics_events_event_type_check
    check (event_type in (
      'email_sent', 'delivered', 'bounced', 'opened', 'clicked', 'replied',
      'positive_reply', 'meeting_booked', 'unsubscribed', 'spam_report', 'campaign_completed'
    )),
  -- Loosely-typed reference (not a foreign key) to whatever this event is
  -- about — a campaign, lead, mailbox, domain, or warmup profile id, or
  -- null/'organization' for an org-wide event. Deliberately decoupled from
  -- those tables so recording an event, or adding a new subject kind later
  -- (Revenue Analytics, Cohorts, A/B Testing), never needs a migration
  -- here.
  subject_type text
    constraint analytics_events_subject_type_check
    check (subject_type in ('organization', 'campaign', 'lead', 'mailbox', 'domain', 'warmup_profile')),
  subject_id uuid,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.analytics_events is 'Generic, organization-scoped analytics event log. See lib/analytics/events.ts for the event/subject type catalog.';
comment on column public.analytics_events.subject_type is 'What kind of thing this event is about, if anything specific — not a foreign key (the subject may live in any of several tables, or none).';
comment on column public.analytics_events.occurred_at is 'When the event actually happened (may differ from created_at for events recorded after the fact, e.g. a backfill).';

create index analytics_events_organization_id_event_type_occurred_at_idx
  on public.analytics_events (organization_id, event_type, occurred_at desc);
create index analytics_events_subject_idx
  on public.analytics_events (organization_id, subject_type, subject_id);

alter table public.analytics_events enable row level security;

create policy analytics_events_select_member on public.analytics_events
  for select using (public.is_organization_member(organization_id));

create policy analytics_events_insert_member on public.analytics_events
  for insert with check (public.is_organization_member(organization_id));

-- No update/delete policy: it's a log.

-- Precomputed daily counts per (event_type, subject) — what the
-- aggregation layer (lib/analytics/aggregations.ts) and dashboard cards
-- read for any date range wider than "scan raw events," so a dashboard
-- never has to full-scan analytics_events as event volume grows.
-- subject_type/subject_id are NOT NULL (unlike analytics_events above)
-- specifically so the unique constraint below behaves correctly — Postgres
-- treats NULL as distinct from NULL in a unique index, which would let
-- multiple "no specific subject" rollup rows coexist for the same
-- (org, date, event_type) instead of upserting into one. An org-wide
-- rollup therefore always sets subject_type='organization' and
-- subject_id=organization_id rather than leaving them empty — see
-- lib/db/analytics.ts's upsertDailyRollup.
create table public.analytics_daily_rollups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  rollup_date date not null,
  event_type text not null
    constraint analytics_daily_rollups_event_type_check
    check (event_type in (
      'email_sent', 'delivered', 'bounced', 'opened', 'clicked', 'replied',
      'positive_reply', 'meeting_booked', 'unsubscribed', 'spam_report', 'campaign_completed'
    )),
  subject_type text not null
    constraint analytics_daily_rollups_subject_type_check
    check (subject_type in ('organization', 'campaign', 'lead', 'mailbox', 'domain', 'warmup_profile')),
  subject_id uuid not null,
  event_count integer not null default 0
    constraint analytics_daily_rollups_event_count_check check (event_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_daily_rollups_unique_key unique (organization_id, rollup_date, event_type, subject_type, subject_id)
);

comment on table public.analytics_daily_rollups is 'Precomputed daily event counts per subject — written only by a future aggregation worker (service role). No rows exist yet.';

create index analytics_daily_rollups_org_date_idx on public.analytics_daily_rollups (organization_id, rollup_date desc);

alter table public.analytics_daily_rollups enable row level security;

create policy analytics_daily_rollups_select_member on public.analytics_daily_rollups
  for select using (public.is_organization_member(organization_id));

-- No insert/update/delete policy for the RLS-scoped client — same
-- "worker/service-role only" carve-out as billing_customers/subscriptions
-- (20260731140000_billing.sql) and warmup_stats (20260802100000_warmup.sql).

create trigger analytics_daily_rollups_set_updated_at
  before update on public.analytics_daily_rollups
  for each row execute function public.set_updated_at();

-- Point-in-time snapshot of a computed metric set (see
-- lib/analytics/snapshots.ts) — what a period-over-period comparison reads
-- instead of recomputing history from raw events every time. Same
-- "worker-only write" shape as analytics_daily_rollups; no rows exist yet.
create table public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  snapshot_date date not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_snapshots_org_date_key unique (organization_id, snapshot_date)
);

comment on table public.analytics_snapshots is 'Frozen metric values for one date, for historical comparison — written only by a future job (service role). No rows exist yet.';

alter table public.analytics_snapshots enable row level security;

create policy analytics_snapshots_select_member on public.analytics_snapshots
  for select using (public.is_organization_member(organization_id));

-- Tracks a future aggregation/snapshot worker's runs — what actually
-- computed analytics_daily_rollups/analytics_snapshots rows, and whether
-- it succeeded. No scheduler exists yet (see lib/warmup/queue.ts's
-- equivalent no-op seam for the same reasoning); this table exists so that
-- worker has somewhere to record state from day one instead of a schema
-- change alongside it.
create table public.analytics_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_type text not null
    constraint analytics_jobs_job_type_check check (job_type in ('daily_rollup', 'snapshot')),
  status text not null default 'pending'
    constraint analytics_jobs_status_check check (status in ('pending', 'running', 'completed', 'failed')),
  target_date date not null,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_jobs_org_type_date_key unique (organization_id, job_type, target_date)
);

comment on table public.analytics_jobs is 'Run history for a future rollup/snapshot worker — written only by that worker (service role). No rows exist yet.';

create index analytics_jobs_status_idx on public.analytics_jobs (status);

alter table public.analytics_jobs enable row level security;

create policy analytics_jobs_select_member on public.analytics_jobs
  for select using (public.is_organization_member(organization_id));

create trigger analytics_jobs_set_updated_at
  before update on public.analytics_jobs
  for each row execute function public.set_updated_at();
