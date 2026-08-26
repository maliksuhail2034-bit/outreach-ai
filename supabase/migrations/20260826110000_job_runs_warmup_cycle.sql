-- Widens job_runs.job to accept 'warmup-cycle' (see
-- app/api/cron/warmup-cycle/route.ts / lib/monitoring/heartbeat.ts's
-- CronJobName), same pattern 20260816100000_scalability_phase_b_rollup_
-- infrastructure.sql already used to add 'analytics-rollup'/
-- 'retention-cleanup'. Purely additive — every existing row and every other
-- allowed value is unchanged.

alter table public.job_runs
  drop constraint job_runs_job_check;

alter table public.job_runs
  add constraint job_runs_job_check
  check (job in (
    'send-emails', 'sync-replies', 'verify-leads', 'deliverability-health-check',
    'integrations-digest', 'analytics-rollup', 'retention-cleanup', 'warmup-cycle'
  ));
