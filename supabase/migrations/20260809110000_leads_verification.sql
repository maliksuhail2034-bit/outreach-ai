-- Email Verification v1 — a single verification_status column on leads
-- (same "one typed column + check constraint" precedent as leads_status),
-- not a separate audit/history table: V1 stores the latest verification
-- outcome in place, overwriting on re-verify. verification_detail carries
-- provider-specific sub-signals (disposable/role/catch-all flags, raw
-- result) as JSON so the column shape doesn't need to change if
-- MillionVerifier's response fields change or a second provider is added
-- with a different taxonomy.
--
-- verification_locked_until mirrors campaign_leads.locked_until exactly:
-- bulk verification is queued and claimed by a cron worker the same way
-- campaign sends are (see claim_due_sends()), not run as a synchronous
-- batch loop inside a Server Function. 'pending' is the queued-for-worker
-- state; claim_due_verifications() below only ever selects that state, so
-- once a claimed lead's status changes to anything else the claim loop
-- naturally stops touching it — no separate "done" flag needed.

alter table public.leads
  add column verification_status text not null default 'unverified'
    constraint leads_verification_status_check
    check (verification_status in ('unverified', 'pending', 'valid', 'invalid', 'catch_all', 'unknown', 'error')),
  add column verification_risk_score smallint,
  add column verification_detail jsonb,
  add column verified_at timestamptz,
  add column verification_locked_until timestamptz;

comment on column public.leads.verification_status is 'Latest email verification outcome (V1: in-place only, no history table). ''pending'' means queued for the verify-leads cron worker.';
comment on column public.leads.verification_risk_score is 'Derived 0-100 score (see lib/verification/providers/millionverifier.ts) — MillionVerifier''s API does not return a score directly, this is computed from its result/quality fields.';
comment on column public.leads.verification_detail is 'Raw provider signals (disposable/role/catch-all, subresult, error message) as JSON, or null if never verified.';
comment on column public.leads.verification_locked_until is 'Claim lock for the bulk verification worker, mirrors campaign_leads.locked_until.';

create index leads_verification_status_idx on public.leads (verification_status);

-- Mirrors claim_due_sends() (see the claim_due_sends migration): atomic
-- row-level claim via `for update skip locked` so an overlapping worker
-- invocation can't double-claim (and double-spend provider credits on) the
-- same lead. No daily-limit/suppression logic needed here — verification
-- has no per-day cap and isn't subject to suppression lists.
create or replace function public.claim_due_verifications(p_limit integer default 25)
returns setof public.leads
language plpgsql
as $$
begin
  return query
  with candidates as (
    select id
    from public.leads
    where verification_status = 'pending'
      and (verification_locked_until is null or verification_locked_until < now())
    order by updated_at
    limit p_limit
    for update skip locked
  )
  update public.leads
  set verification_locked_until = now() + interval '10 minutes'
  where id in (select id from candidates)
  returning *;
end;
$$;
