-- Phase 3B Part 3 Enterprise Readiness (security audit, item 1): request-
-- frequency abuse control, distinct from lib/billing/limits.ts's resource
-- quotas (mailbox/campaign/lead counts, daily sends) — a paying org nowhere
-- near its plan's resource limits could still hammer a Server Function
-- hundreds of times a minute without this.
--
-- Append-only event log, not a running counter table — mirrors
-- claim_due_sends()'s own reasoning (20260730100020_claim_due_sends.sql):
-- daily send limits are computed by counting rows in a time window rather
-- than maintaining a counter, explicitly because a counter adds write
-- amplification and a drift-recovery problem for no benefit at this scale.
-- The same reasoning applies here — one row per attempt, checked with a
-- windowed count(*), same shape as every other append-only table in this
-- schema (job_runs, warmup_events, email_events).
--
-- No RLS policies at all — same carve-out as stripe_webhook_events/
-- job_runs: this is system/abuse-control bookkeeping, not organization-
-- owned data a user should ever read directly, and it must be writable from
-- pre-authentication contexts (login/signup have no session yet, so no
-- organization to scope a member-based policy to even if one existed).
-- Every read/write goes through the service role via
-- lib/rate-limit/providers/postgres.ts, never a user-scoped client.
create table public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  identity text not null,
  created_at timestamptz not null default now()
);

comment on table public.rate_limit_events is 'One row per rate-limited attempt (login, AI generation, campaign actions, etc.) — checked with a windowed count(*), not a running counter. See lib/rate-limit/ for the single writer/reader.';
comment on column public.rate_limit_events.scope is 'Which protected action this attempt was for, e.g. "auth:sign_in", "ai:generate" — see lib/rate-limit/config.ts for the full catalog.';
comment on column public.rate_limit_events.identity is 'Who the attempt is attributed to — an IP address for unauthenticated scopes, an organization id for authenticated ones. Never a raw email address in cleartext beyond what forgot-password rate limiting itself requires.';

create index rate_limit_events_scope_identity_created_at_idx on public.rate_limit_events (scope, identity, created_at desc);

alter table public.rate_limit_events enable row level security;

-- No policies at all — see the table comment above.

-- Atomic check-and-record: counts prior attempts for (scope, identity)
-- within the trailing window and, if under the limit, records this one in
-- the same statement. An advisory lock keyed on (scope, identity) closes
-- the race a plain "select count, then insert" would have under concurrent
-- requests from the same caller — auto-released at transaction end, so a
-- crash mid-call can't leave it held. This is an abuse-mitigation
-- guarantee, not the hard correctness guarantee send_attempts/
-- claim_due_sends provide for the send pipeline — acceptable for this
-- purpose.
create or replace function public.record_rate_limit_attempt(
  p_scope text,
  p_identity text,
  p_window_seconds integer,
  p_max_attempts integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_scope || ':' || p_identity));

  select count(*), min(created_at)
    into v_count, v_oldest
    from public.rate_limit_events
    where scope = p_scope and identity = p_identity and created_at >= v_window_start;

  if v_count >= p_max_attempts then
    return query select
      false,
      greatest(0, ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))::integer);
    return;
  end if;

  insert into public.rate_limit_events (scope, identity) values (p_scope, p_identity);
  return query select true, 0;
end;
$$;
