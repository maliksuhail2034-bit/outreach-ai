-- Supabase-native scheduler for /api/cron/warmup-cycle and
-- /api/cron/verify-leads.
--
-- GitHub Actions throttles scheduled workflows: cron-warmup-cycle.yml's
-- "*/15" and cron-verify-leads.yml's "*/10" have actually fired about every
-- 4 hours. Warmup pacing assumes a cycle every 15 minutes (a profile's next
-- send is 20-240 minutes out), so at ~6 cycles a day each profile sent only
-- ~5 warmup emails a day whatever its configured ramp; queued lead
-- verifications would wait hours. This schedules both from the database,
-- through the same dispatcher as send-emails and sync-replies:
--
--   pg_cron, every 15 minutes (:07/:22/:37/:52)
--     -> private.invoke_cron_endpoint('/api/cron/warmup-cycle')
--   pg_cron, every 10 minutes (:03/:13/.../:53)
--     -> private.invoke_cron_endpoint('/api/cron/verify-leads')
--     -> the existing routes (lib/monitoring/run-cron-job.ts) and workers.
--
-- Offset minutes so neither fires in the same second as send-emails (every
-- minute) and sync-replies (every 2 minutes), which both fire at :00.
--
-- Overlapping runs are safe: claim_due_warmup_sends() and
-- claim_due_verifications() both claim with SKIP LOCKED and lease each row
-- for 10 minutes, so a row still held by a slow run is skipped, not
-- processed twice. The GitHub Actions workflows keep running during rollout
-- for the same reason, and are retired separately.
--
-- The dispatcher is replaced only to widen its allowlist to these two
-- routes. Everything else is unchanged: the same Vault secrets
-- ('cron_app_url', 'cron_secret'), bearer token, pg_net POST and 4-minute
-- timeout (a warmup cycle takes ~20s and a verification run ~1s today).
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
    '/api/cron/verify-leads'
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

comment on function private.invoke_cron_endpoint(text) is 'pg_cron dispatcher: POSTs to an allowlisted app cron route (only /api/cron/send-emails, /api/cron/sync-replies, /api/cron/warmup-cycle and /api/cron/verify-leads) with the CRON_SECRET bearer token, both read from Vault. Returns the pg_net request id, or null when the Vault secrets are not configured.';

revoke all on function private.invoke_cron_endpoint(text) from public, anon, authenticated, service_role;

-- cron.schedule() upserts by job name for the calling role, so re-running
-- this is idempotent. The send-emails, sync-replies and run-history cleanup
-- jobs are left as they are.
select cron.schedule(
  'warmup-cycle',
  '7,22,37,52 * * * *',
  $$select private.invoke_cron_endpoint('/api/cron/warmup-cycle')$$
);

select cron.schedule(
  'verify-leads',
  '3-59/10 * * * *',
  $$select private.invoke_cron_endpoint('/api/cron/verify-leads')$$
);
