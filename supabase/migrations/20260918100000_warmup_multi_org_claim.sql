-- Generalize claim_due_warmup_sends to claim across ALL organizations,
-- removing the TypeScript-layer single-org restriction documented in
-- lib/warmup/owner-scope.ts (20260826100000_warmup_engine.sql's own header
-- comment already noted this function "stays fully generic/multi-tenant" —
-- only the p_organization_id parameter needs to go). Every eligibility
-- predicate, the FOR UPDATE SKIP LOCKED claim, the locked_until lease, the
-- ordering, and the limit behavior are preserved exactly as before; only
-- the organization filter is removed. Per-row organization_id on the
-- returned warmup_profiles rows continues to drive all downstream scoping
-- (peer selection, sends, stats), which was already organization-scoped —
-- see lib/warmup/warmup-worker.ts.
--
-- create or replace function cannot change an existing function's argument
-- list — a different signature creates a second overload instead of
-- replacing the original (this is what made the first attempt at this
-- migration fail: the ensuing unqualified `comment on function` became
-- ambiguous between the two overloads, SQLSTATE 42725). The old
-- (p_organization_id uuid, p_limit integer) overload is explicitly dropped
-- by its exact argument types first, so exactly one function named
-- claim_due_warmup_sends exists afterward. No CASCADE: nothing in this
-- schema references this function by a dependency Postgres tracks (it's
-- only ever invoked via supabase.rpc() from application code, which has no
-- DB-level dependency on it), so a plain DROP is sufficient and safer than
-- risking an unintended cascade. Grants are unaffected — this schema's
-- functions all rely on Supabase's project-level default privileges
-- (EXECUTE to anon/authenticated/service_role), not per-migration GRANT
-- statements, so a newly created function picks up the identical default
-- ACL with nothing extra to restate here.
drop function if exists public.claim_due_warmup_sends(uuid, integer);

create or replace function public.claim_due_warmup_sends(p_limit integer default 10)
returns setof public.warmup_profiles
language plpgsql
as $$
begin
  return query
  with candidates as (
    select wp.id
    from public.warmup_profiles wp
    join public.mailboxes m on m.id = wp.mailbox_id
    where wp.status = 'enabled'
      and wp.stage in ('starting', 'warming', 'healthy', 'cooling')
      and m.status = 'active'
      and (wp.locked_until is null or wp.locked_until < now())
      and (
        (wp.next_send_at is null or wp.next_send_at <= now())
        or exists (
          select 1 from public.warmup_messages wm
          where wm.to_mailbox_id = wp.mailbox_id
            and wm.reply_decision = 'pending'
            and wm.reply_due_at <= now()
        )
      )
    order by wp.updated_at
    limit p_limit
    for update of wp skip locked
  )
  update public.warmup_profiles
  set locked_until = now() + interval '10 minutes'
  where id in (select id from candidates)
  returning *;
end;
$$;

comment on function public.claim_due_warmup_sends(integer) is 'Atomically claims warmup_profiles due for a cycle (fresh send and/or a reply owed) across ALL organizations. Never touches campaign_leads, send_attempts, or claim_due_sends() at all.';
