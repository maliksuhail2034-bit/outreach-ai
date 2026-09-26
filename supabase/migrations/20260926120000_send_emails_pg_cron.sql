-- Supabase-native scheduler for /api/cron/send-emails.
--
-- GitHub Actions' "*/5" schedule for cron-send-emails.yml actually fires
-- every ~3-5 hours (GitHub throttles scheduled workflows), so due sends wait
-- hours. This moves the send-emails trigger into the database:
--
--   pg_cron, every minute
--     -> private.invoke_cron_endpoint('/api/cron/send-emails')
--     -> reads the app URL and CRON_SECRET from Vault
--     -> pg_net async HTTP POST with Authorization: Bearer <CRON_SECRET>
--     -> the existing route (lib/monitoring/run-cron-job.ts) and send worker.
--
-- Overlapping runs are safe: claim_due_sends() locks mailboxes/campaigns/
-- leads with SKIP LOCKED, never claims for a mailbox with a send in flight,
-- and leases what it claims (20260925100000); claim_send_attempt() keeps
-- each step to one send. The GitHub Actions workflow keeps running during
-- rollout for the same reason, and is retired separately.
--
-- Secrets: the Vault secrets 'cron_app_url' and 'cron_secret' are created
-- by hand per environment (Dashboard -> Vault), never in SQL, so their
-- values never appear in migrations, query logs or CLI history. Where they
-- don't exist (local/dev stacks) every run is a logged no-op.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Not listed in the API's exposed schemas (supabase/config.toml [api].schemas),
-- and no API role can even resolve names in it.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- SECURITY INVOKER on purpose: the only intended caller is the pg_cron job,
-- which runs as its owner (postgres), and postgres can already read Vault.
-- A definer function would add a path to Vault for anyone ever granted
-- EXECUTE; an invoker one grants nothing beyond what the caller has.
--
-- The secret is read here, inside the function, so the pg_cron command text
-- (cron.job, cron.job_run_details) is only the call below. It does pass
-- through pg_net's request queue until the background worker sends it.
--
-- Timeout: the send worker stops claiming after 4 minutes
-- (INVOCATION_TIME_BUDGET_MS in lib/email/send-worker.ts), so the request is
-- allowed that long instead of pg_net's 5s default — a normal run is ~2s,
-- but a slow one shouldn't be recorded as timed out while it still runs.
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
  if p_path is distinct from '/api/cron/send-emails' then
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

comment on function private.invoke_cron_endpoint(text) is 'pg_cron dispatcher: POSTs to an allowlisted app cron route (only /api/cron/send-emails) with the CRON_SECRET bearer token, both read from Vault. Returns the pg_net request id, or null when the Vault secrets are not configured.';

revoke all on function private.invoke_cron_endpoint(text) from public, anon, authenticated, service_role;

-- cron.schedule() upserts by job name for the calling role, so re-running
-- this is idempotent.
select cron.schedule(
  'send-emails',
  '* * * * *',
  $$select private.invoke_cron_endpoint('/api/cron/send-emails')$$
);

-- pg_cron never prunes its own run history; at one run a minute it grows by
-- ~1,440 rows a day. Keep a week.
select cron.schedule(
  'cron-job-run-details-cleanup',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
