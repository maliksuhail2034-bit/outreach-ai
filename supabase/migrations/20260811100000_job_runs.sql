-- Phase 3A Enterprise Readiness (Operations & Monitoring): observability
-- ledger for the five cron-triggered workers (app/api/cron/*/route.ts). The
-- audit's Critical finding was that a worker run's outcome only ever lived
-- in platform logs (console.log/console.error) — this persists it so a
-- stuck or silently-failing job is queryable instead of living only in
-- whatever hosting platform happens to retain logs.
--
-- No organization_id: a cron run isn't owned by any one organization, it's
-- system/operational data. Same "nothing but the service role ever needs to
-- touch this table" shape as stripe_webhook_events
-- (20260731140000_billing.sql) — RLS enabled, zero policies, not
-- organization-scoped policies.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null
    constraint job_runs_job_check
    check (job in ('send-emails', 'sync-replies', 'verify-leads', 'deliverability-health-check', 'integrations-digest')),
  status text not null
    constraint job_runs_status_check check (status in ('success', 'error')),
  summary jsonb not null default '{}'::jsonb,
  error text,
  duration_ms integer not null,
  started_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.job_runs is 'One row per cron worker invocation (app/api/cron/*/route.ts) — the same summary/outcome the route already logs to console, persisted so it is queryable. Written only by the cron routes themselves (lib/monitoring/run-cron-job.ts), running as the service role.';
comment on column public.job_runs.job is 'Which cron route ran — matches the route folder name under app/api/cron/.';
comment on column public.job_runs.summary is 'The worker''s own summary object (e.g. SendWorkerSummary), stored as-is. Empty object on an error run, since the worker never returned one.';
comment on column public.job_runs.started_at is 'When the invocation began — distinct from created_at, which is when this row was inserted (after the run finished).';

-- Mirrors the (subject, created_at desc) shape already established by
-- email_events_campaign_id_created_at_idx (20260810100000): "most recent
-- runs for this job" is the only query pattern this table needs to serve
-- well.
create index job_runs_job_created_at_idx on public.job_runs (job, created_at desc);
create index job_runs_status_idx on public.job_runs (status);

alter table public.job_runs enable row level security;

-- No policies at all — same carve-out as stripe_webhook_events: nothing but
-- the cron routes, running as the service role, ever need to read or write
-- this table.
