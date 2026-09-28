-- Supabase-native scheduler for /api/cron/sync-replies.
--
-- GitHub Actions' "*/10" schedule for cron-sync-replies.yml actually fires
-- every ~2-8 hours (GitHub throttles scheduled workflows), while sends run
-- every minute from pg_cron (20260926120000_send_emails_pg_cron.sql). A
-- campaign lead only stops being 'active' once reply sync records its reply,
-- so a reply that arrives between two syncs does not stop a follow-up that
-- comes due in that gap: claim_due_sends() and confirm_send_attempt_eligible()
-- can only see replies that have already been synced. This schedules reply
-- sync from the database too, through the same dispatcher:
--
--   pg_cron, every 2 minutes
--     -> private.invoke_cron_endpoint('/api/cron/sync-replies')
--     -> the existing route (lib/monitoring/run-cron-job.ts) and reply worker.
--
-- Every 2 minutes rather than every minute: each run opens one IMAP login
-- (and, for Gmail/Outlook mailboxes, refreshes one OAuth access token) per
-- mailbox.
--
-- Overlapping runs are safe: claim_mailboxes_for_reply_sync() leases each
-- mailbox for 10 minutes with SKIP LOCKED (20260814100000), so a slow run
-- still holding a mailbox is skipped, not processed twice. The GitHub
-- Actions workflow keeps running during rollout for the same reason, and is
-- retired separately.
--
-- The dispatcher is replaced only to widen its allowlist to this second
-- route. Everything else is unchanged: the same Vault secrets
-- ('cron_app_url', 'cron_secret'), bearer token, pg_net POST and 4-minute
-- timeout (a normal reply-sync run takes seconds, and the route itself runs
-- well inside it). create or replace keeps the function's owner and ACL;
-- the revoke below is restated anyway.

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
  if p_path is null or p_path not in ('/api/cron/send-emails', '/api/cron/sync-replies') then
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

comment on function private.invoke_cron_endpoint(text) is 'pg_cron dispatcher: POSTs to an allowlisted app cron route (only /api/cron/send-emails and /api/cron/sync-replies) with the CRON_SECRET bearer token, both read from Vault. Returns the pg_net request id, or null when the Vault secrets are not configured.';

revoke all on function private.invoke_cron_endpoint(text) from public, anon, authenticated, service_role;

-- cron.schedule() upserts by job name for the calling role, so re-running
-- this is idempotent. The send-emails and run-history cleanup jobs are left
-- as they are.
select cron.schedule(
  'sync-replies',
  '*/2 * * * *',
  $$select private.invoke_cron_endpoint('/api/cron/sync-replies')$$
);
