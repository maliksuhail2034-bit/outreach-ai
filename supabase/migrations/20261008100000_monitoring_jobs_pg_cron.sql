-- Supabase-native scheduler for the four remaining GitHub Actions cron jobs:
-- /api/cron/deliverability-health-check, /api/cron/analytics-rollup,
-- /api/cron/retention-cleanup and /api/cron/integrations-digest.
--
-- GitHub Actions throttles scheduled workflows. Over 30 days the hourly
-- deliverability health check fired 168 times instead of 720 (gaps of up to
-- ~10 hours), and the daily jobs ran 3-8 hours late, one day not at all.
-- This schedules all four from the database, through the same dispatcher as
-- send-emails, sync-replies, warmup-cycle and verify-leads:
--
--   pg_cron, hourly at :41
--     -> private.invoke_cron_endpoint('/api/cron/deliverability-health-check')
--   pg_cron, daily at 01:05 UTC
--     -> private.invoke_cron_endpoint('/api/cron/analytics-rollup')
--   pg_cron, daily at 02:10 UTC
--     -> private.invoke_cron_endpoint('/api/cron/retention-cleanup')
--   pg_cron, daily at 08:15 UTC
--     -> private.invoke_cron_endpoint('/api/cron/integrations-digest')
--     -> the existing routes (lib/monitoring/run-cron-job.ts) and workers.
--
-- Unlike the earlier moves, the GitHub Actions workflows are removed in the
-- same change rather than kept running during rollout: the integrations
-- digest has no duplicate-delivery protection (every run posts a digest to
-- every enabled integration), so it must never run from both schedulers.
--
-- The dispatcher is replaced only to widen its allowlist to these four
-- routes. Everything else is unchanged: the same Vault secrets
-- ('cron_app_url', 'cron_secret'), bearer token, pg_net POST and 4-minute
-- timeout (each of these jobs takes under 2 seconds today).
-- create or replace keeps the function's owner and ACL; the revoke below is
-- restated anyway.

create or replace function private.invoke_cron_endpoint(p_path text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_app_url text;
  v_cron_secret text;
begin
  if p_path is null or p_path not in (
    '/api/cron/send-emails',
    '/api/cron/sync-replies',
    '/api/cron/warmup-cycle',
    '/api/cron/verify-leads',
    '/api/cron/deliverability-health-check',
    '/api/cron/analytics-rollup',
    '/api/cron/retention-cleanup',
    '/api/cron/integrations-digest'
  ) then
    raise exception 'invoke_cron_endpoint: path % is not allowed', p_path
      using errcode = '42501';
  end if;

  select ds.decrypted_secret into v_app_url
  from vault.decrypted_secrets ds
  where ds.name = 'cron_app_url';

  select ds.decrypted_secret into v_cron_secret
  from vault.decrypted_secrets ds
  where ds.name = 'cron_secret';

  if v_app_url is null or v_cron_secret is null then
    raise notice 'invoke_cron_endpoint: Vault secrets cron_app_url/cron_secret not configured, skipping %', p_path;
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_app_url, '/') || p_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 240000
  );
end;
$$;

comment on function private.invoke_cron_endpoint(text) is 'pg_cron dispatcher: POSTs to an allowlisted app cron route (only /api/cron/send-emails, /api/cron/sync-replies, /api/cron/warmup-cycle, /api/cron/verify-leads, /api/cron/deliverability-health-check, /api/cron/analytics-rollup, /api/cron/retention-cleanup and /api/cron/integrations-digest) with the CRON_SECRET bearer token, both read from Vault. Returns the pg_net request id, or null when the Vault secrets are not configured.';

revoke all on function private.invoke_cron_endpoint(text) from public, anon, authenticated, service_role;

-- cron.schedule() upserts by job name for the calling role, so re-running
-- this is idempotent. The send-emails, sync-replies, warmup-cycle,
-- verify-leads and run-history cleanup jobs are left as they are.
select cron.schedule(
  'deliverability-health-check',
  '41 * * * *',
  $$select private.invoke_cron_endpoint('/api/cron/deliverability-health-check')$$
);

select cron.schedule(
  'analytics-rollup',
  '5 1 * * *',
  $$select private.invoke_cron_endpoint('/api/cron/analytics-rollup')$$
);

select cron.schedule(
  'retention-cleanup',
  '10 2 * * *',
  $$select private.invoke_cron_endpoint('/api/cron/retention-cleanup')$$
);

select cron.schedule(
  'integrations-digest',
  '15 8 * * *',
  $$select private.invoke_cron_endpoint('/api/cron/integrations-digest')$$
);
